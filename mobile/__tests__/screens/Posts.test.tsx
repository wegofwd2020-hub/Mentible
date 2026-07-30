import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen, { assemblePost } from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));

import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";

const VARIANTS = [
  { hook: "Hook 0", body: "Body 0", hashtags: ["#one"], cta: "Read more" },
  { hook: "Hook 1", body: "Body 1", hashtags: ["#two"], cta: null },
  { hook: "Hook 2", body: "Body 2", hashtags: ["#three"], cta: null },
];

function mockHook(over: Record<string, unknown>) {
  (useMakePost as jest.Mock).mockReturnValue({
    status: "idle", error: null, variants: [], provenance: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

beforeEach(() => jest.clearAllMocks());

it("disables Generate until source text is entered", () => {
  mockHook({});
  render(<PostsScreen />);
  const btn = screen.getByLabelText("Make posts");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Source text"), "Stormwater basics.");
  expect(screen.getByLabelText("Make posts").props.accessibilityState?.disabled).toBe(false);
});

it("renders 3 variant cards and the AI-generated tag when done", () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  expect(screen.getByText("Hook 0")).toBeTruthy();
  expect(screen.getByText("Hook 2")).toBeTruthy();
  expect(screen.getByText(/ai-generated/i)).toBeTruthy();
});

it("copies the assembled post when a Copy button is pressed", async () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Copy post 1"));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(assemblePost(VARIANTS[0])));
});

it("shows the error text on failure", () => {
  mockHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("assemblePost joins hook, body, hashtags and cta", () => {
  expect(assemblePost(VARIANTS[0])).toBe("Hook 0\n\nBody 0\n\n#one\n\nRead more");
  expect(assemblePost(VARIANTS[1])).toBe("Hook 1\n\nBody 1\n\n#two");
});
