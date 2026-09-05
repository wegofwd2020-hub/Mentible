import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TranscriptReview from "@/../app/trust/transcript/[artifactId]";
import { getTranscriptVersion } from "@/api/trustClient";

const mockApprove = jest.fn().mockResolvedValue({});
const mockUnapprove = jest.fn().mockResolvedValue({});
const mockAddVersion = jest.fn().mockResolvedValue({ id: "v2" });

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ artifactId: "a1", versionId: "v1", projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ approve: mockApprove, unapprove: mockUnapprove, addVersion: mockAddVersion }),
}));
jest.mock("@/api/trustClient", () => ({ getTranscriptVersion: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));

const transcript = {
  id: "v1",
  artifact_id: "a1",
  version_no: 1,
  is_validated: false,
  recorded_via: null,
  created_at: null,
  content: {
    language: "ta",
    segments: [
      { text: "hello there", start: 0, end: 1, confidence: 0.95, speaker: null },
      { text: "muffled bit", start: 1, end: 2, confidence: 0.2, speaker: null },
    ],
    source_audio_ref: "input-1",
    stt_meta: { provider: "groq", model: "whisper-large-v3" },
  },
};

describe("TranscriptReview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getTranscriptVersion as jest.Mock).mockResolvedValue(transcript);
  });

  it("renders both segments and saves edits as a new version, preserving stt_meta", async () => {
    render(<TranscriptReview />);
    await waitFor(() => expect(screen.getByDisplayValue("hello there")).toBeTruthy());
    expect(screen.getByDisplayValue("muffled bit")).toBeTruthy();

    fireEvent.changeText(screen.getByDisplayValue("muffled bit"), "clearer now");
    fireEvent.press(screen.getByLabelText("Save transcript"));

    await waitFor(() => expect(mockAddVersion).toHaveBeenCalledTimes(1));
    const [artifactId, content] = mockAddVersion.mock.calls[0];
    expect(artifactId).toBe("a1");
    expect(content.stt_meta).toEqual({ provider: "groq", model: "whisper-large-v3" });
    expect(content.language).toBe("ta");
    expect(content.segments.map((s: { text: string }) => s.text)).toEqual(
      expect.arrayContaining(["hello there", "clearer now"]),
    );
    // saved segments carry no render key
    expect(content.segments[0].key).toBeUndefined();
  });

  it("approves the current version", async () => {
    render(<TranscriptReview />);
    await waitFor(() => expect(screen.getByLabelText("Approve version 1")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Approve version 1"));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith("v1"));
  });
});
