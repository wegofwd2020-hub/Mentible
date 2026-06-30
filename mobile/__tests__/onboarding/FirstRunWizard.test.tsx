import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Controllable auth status (drives the coordinator's env auto-skips).
let mockAuthStatus = "signed_in";
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: mockAuthStatus,
    session: null,
    accessToken: null,
    signIn: jest.fn().mockResolvedValue({ error: null }),
    signUp: jest.fn().mockResolvedValue({ error: null }),
    signInWithGoogle: jest.fn().mockResolvedValue({ error: null }),
    resetPassword: jest.fn().mockResolvedValue({ error: null }),
    signOut: jest.fn(),
  }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn() }),
}));

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn().mockResolvedValue(null),
  saveApiKey: jest.fn().mockResolvedValue(undefined),
  deleteApiKey: jest.fn().mockResolvedValue(undefined),
  maskApiKey: (k: string) => `sk-…${k.slice(-4)}`,
  isValidApiKey: (v: string) => v.length >= 20,
}));

import { FirstRunWizard } from "../../src/onboarding/FirstRunWizard";
import { applyStepStatuses, relaunchStep } from "../../src/onboarding/firstRunState";

// This suite renders the wizard's heavy step trees (a Modal wrapping KeyStep with
// the provider form + guide cards). On a loaded CI runner the *first* render in
// the file — which also pays one-time module init — has occasionally exceeded
// Jest's 5 s default and timed out (no assertion failure, no infinite hang: all
// async here is microtask-bounded mocks). Give the file generous headroom so a
// slow-but-correct cold start can't trip the timeout. See PR de-flaking this.
jest.setTimeout(20000);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockAuthStatus = "signed_in";
});

describe("FirstRunWizard", () => {
  it("starts on the Add-a-key step for a signed-in user, Continue locked until a key exists", async () => {
    // Pre-seed signup as done (a signed-in user has it auto-skipped anyway — that
    // mechanism is covered by the signed-out→signed-in test below) so the wizard
    // lands directly on the key step, trimming the load→auto-skip→re-render churn
    // that made this first-in-file test the flaky one.
    await applyStepStatuses({ signup: "done" });
    render(<FirstRunWizard />);
    expect(await screen.findByText("Add an LLM key")).toBeTruthy();
    // Assert Continue via waitFor (like the sibling tests) so the act() scope
    // stays open until KeyStep's saved-keys probe settles — a bare synchronous
    // getByLabelText here lets that update land post-test, un-acted.
    await waitFor(() =>
      expect(screen.getByLabelText("Continue").props.accessibilityState?.disabled).toBe(true),
    );
  });

  it("unlocks Continue after saving a key and advances to the tour", async () => {
    render(<FirstRunWizard />);
    await screen.findByText("Add an LLM key");

    fireEvent.changeText(screen.getByPlaceholderText("sk-ant-..."), "sk-ant-abcdefghijklmnopqrstuvwxyz");
    fireEvent.press(screen.getByLabelText("Save API key"));

    await waitFor(() =>
      expect(screen.getByLabelText("Continue").props.accessibilityState?.disabled).toBe(false),
    );
    fireEvent.press(screen.getByLabelText("Continue"));
    expect(await screen.findByText("Meet your tabs")).toBeTruthy();
  });

  it("walks both tour pages and opens the Library on finish", async () => {
    await applyStepStatuses({ signup: "done", key: "done" });
    render(<FirstRunWizard />);

    expect(await screen.findByText("Meet your tabs")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Next"));
    expect(await screen.findByText("Open a book to read")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Open my Library"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/library"));
    await waitFor(() => expect(screen.queryByText("Open a book to read")).toBeNull());
  });

  it("skips the key step to the tour, then skips the tour to close", async () => {
    render(<FirstRunWizard />);
    await screen.findByText("Add an LLM key");

    fireEvent.press(screen.getByLabelText("Skip for now"));
    expect(await screen.findByText("Meet your tabs")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Skip tour"));
    await waitFor(() => expect(screen.queryByText("Meet your tabs")).toBeNull());
  });

  it("re-shows the wizard when a step is relaunched from Help", async () => {
    await applyStepStatuses({ signup: "done", key: "done", tour: "done" });
    render(<FirstRunWizard />);
    // Everything done → nothing visible.
    await waitFor(() => expect(screen.queryByText("Meet your tabs")).toBeNull());

    await act(async () => {
      await relaunchStep("tour");
    });
    expect(await screen.findByText("Meet your tabs")).toBeTruthy();
  });

  it("shows the sign-up step when signed out, then auto-advances once signed in", async () => {
    mockAuthStatus = "signed_out";
    const { rerender } = render(<FirstRunWizard />);
    expect(await screen.findByText("Create your account")).toBeTruthy();

    mockAuthStatus = "signed_in";
    rerender(<FirstRunWizard />);
    expect(await screen.findByText("Add an LLM key")).toBeTruthy();
  });
});
