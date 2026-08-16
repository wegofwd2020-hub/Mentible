const mockGenerateVersion = jest.fn(
  async (_id: string, _opts?: { guidance?: string; onPhase?: (p: "queued" | "running") => void }) => ({
    id: "v3", artifact_id: "a1", version_no: 3, created_at: null,
  }),
);
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion: jest.fn(), generateVersion: mockGenerateVersion, approve: jest.fn() }),
}));
// This screen now renders through TopicRenderer (T3), whose native branch
// pulls in react-native-webview — stub it (these tests run on the jest-expo
// default "ios" platform, where the view stays plain-text, but the module
// still gets required at import time).
jest.mock("react-native-webview", () => ({ default: () => null }));
jest.mock("@/components/LessonRenderer", () => require("../helpers/mockTopicRenderer"));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "@/lib/alert";
import TrustVersion from "@/../app/trust/version/[versionId]";

beforeEach(() => { jest.clearAllMocks(); });

it("regenerates with guidance", async () => {
  const { getByText, getByLabelText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("H")).toBeTruthy());
  fireEvent.press(getByLabelText("Revise draft"));
  fireEvent.changeText(getByLabelText("Regeneration guidance"), "focus on 2026 costs");
  fireEvent.press(getByLabelText("Generate new version"));
  await waitFor(() =>
    expect(mockGenerateVersion).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ guidance: "focus on 2026 costs", onPhase: expect.any(Function) }),
    ),
  );
});

it("pressing Generate new version shows the bar and flips Waiting -> Generating via onPhase, then navigates", async () => {
  let resolve!: (v: { id: string; artifact_id: string; version_no: number; created_at: null }) => void;
  let phaseCb: ((p: "queued" | "running") => void) | undefined;
  mockGenerateVersion.mockImplementation((_id: string, opts?: { onPhase?: (p: "queued" | "running") => void }) => {
    phaseCb = opts?.onPhase;
    return new Promise((r) => { resolve = r; });
  });

  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Revise draft"));
  fireEvent.press(screen.getByLabelText("Generate new version"));

  // The button's own label also reads "Generating…" while busy, so query the
  // progress bar's accessibilityLabel (distinct from the button's static
  // "Generate new version" label) to avoid an ambiguous text match.
  expect(await screen.findByLabelText(/waiting/i)).toBeTruthy();     // queued
  act(() => phaseCb?.("running"));
  expect(await screen.findByLabelText(/generating/i)).toBeTruthy();  // running

  act(() => resolve({ id: "v3", artifact_id: "a1", version_no: 3, created_at: null }));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/trust/version/[versionId]",
      params: { versionId: "v3", artifactId: "a1", projectId: "p1" },
    }),
  );
});

it("a failed regen surfaces the job's error message, not a bare 'Try again.'", async () => {
  mockGenerateVersion.mockRejectedValue(new Error("rate limited, try again shortly"));
  const alertSpy = jest.spyOn(Alert, "alert");

  render(<TrustVersion />);
  await waitFor(() => expect(screen.getByText("H")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Revise draft"));
  fireEvent.press(screen.getByLabelText("Generate new version"));

  await waitFor(() =>
    expect(alertSpy).toHaveBeenCalledWith("Couldn't regenerate", "rate limited, try again shortly"),
  );
});
