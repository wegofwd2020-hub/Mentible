import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/hooks/useMakeCard", () => ({ useMakeCard: jest.fn() }));
jest.mock("@/hooks/useMakeCarousel", () => ({ useMakeCarousel: jest.fn() }));
jest.mock("@/hooks/useMakeAnimated", () => ({ useMakeAnimated: jest.fn() }));
jest.mock("@/hooks/useMakeAudio", () => ({ useMakeAudio: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-x") }));
jest.mock("@/lib/pickReferenceImage", () => ({ pickReferenceImage: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/api/trustClient", () => ({
  listOwnedProjects: jest.fn(),
  getProject: jest.fn(),
}));
jest.mock("@/storage/epubLibrary", () => ({ downloadArtifact: jest.fn().mockResolvedValue({}) }));
jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  useAudioPlayerStatus: jest.fn(() => ({ playing: false })),
}));

import { useMakePost } from "@/hooks/useMakePost";
import { useMakeCard } from "@/hooks/useMakeCard";
import { useMakeCarousel } from "@/hooks/useMakeCarousel";
import { useMakeAnimated } from "@/hooks/useMakeAnimated";
import { useMakeAudio } from "@/hooks/useMakeAudio";
import { useAuth } from "@/auth/AuthProvider";
import { listOwnedProjects, getProject } from "@/api/trustClient";
import { downloadArtifact } from "@/storage/epubLibrary";

function mockPostHook(over: Record<string, unknown> = {}) {
  (useMakePost as jest.Mock).mockReturnValue({
    status: "idle", error: null, variants: [], provenance: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockCardHook(over: Record<string, unknown> = {}) {
  (useMakeCard as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockCarouselHook(over: Record<string, unknown> = {}) {
  (useMakeCarousel as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockAnimatedHook(over: Record<string, unknown> = {}) {
  (useMakeAnimated as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}
function mockAudioHook(over: Record<string, unknown> = {}) {
  (useMakeAudio as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null, run: jest.fn(), reset: jest.fn(), ...over,
  });
}

const VALIDATED_PROJECT = {
  id: "proj-1", title: "Stormwater 101", status: "active",
  created_at: null, topic: null, audience: null, goal: null,
};

const VALIDATED_PROJECT_DETAIL = {
  project: {
    id: "proj-1", title: "Stormwater 101", topic: null, audience: null, goal: null,
    status: "active", created_at: null,
    toc: {
      subjects: [
        {
          subject_label: "Water",
          units: [{ id: "topic-1", title: "Detention basins", subtopics: [], prerequisites: [] }],
        },
      ],
    },
  },
  artifacts: [],
  inputs: [],
  my_role: "owner",
  topic_status: [{ topic_id: "topic-1", status: "validated", latest_version_id: "tv-1", version_no: 1 }],
};

const AUDIO_RESULT = {
  script: "Water finds the lowest point.",
  title: "Detention basins, decoded",
  audio_base64: "SUQzZmFrZQ==",
  mime: "audio/mpeg",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostHook();
  mockCardHook();
  mockCarouselHook();
  mockAnimatedHook();
  mockAudioHook();
  (useAuth as jest.Mock).mockReturnValue({ accessToken: "token-x", status: "signed_in" });
  (listOwnedProjects as jest.Mock).mockResolvedValue([VALIDATED_PROJECT]);
  (getProject as jest.Mock).mockResolvedValue(VALIDATED_PROJECT_DETAIL);
});

it("switching to Audio mode shows the source field", async () => {
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  expect(await screen.findByLabelText("Audio source text")).toBeTruthy();
});

it("Make narration with source text calls useMakeAudio.run with source_text", async () => {
  const runMock = jest.fn();
  mockAudioHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Audio source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Make narration"));
  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ source_text: "Detention basins hold stormwater." }),
  );
});

it("renders the title/script, an inline player, and a Download button for a returned result", async () => {
  mockAudioHook({ status: "done", result: AUDIO_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());

  expect(screen.getByText("Detention basins, decoded")).toBeTruthy();
  expect(screen.getByText("Water finds the lowest point.")).toBeTruthy();
  expect(await screen.findByLabelText("Play narration")).toBeTruthy();
  expect(screen.getByLabelText("Download narration")).toBeTruthy();
});

it("pressing Download calls downloadArtifact with narration.mp3 and audio/mpeg", async () => {
  mockAudioHook({ status: "done", result: AUDIO_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText("Download narration"));
  await waitFor(() =>
    expect(downloadArtifact).toHaveBeenCalledWith(expect.anything(), "narration.mp3", "audio/mpeg"),
  );
});

it("picking a validated section calls useMakeAudio.run with topic_version_id, not source_text", async () => {
  const runMock = jest.fn();
  mockAudioHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  fireEvent.press(screen.getByLabelText("Audio source: Pick a validated section"));

  const row = await screen.findByLabelText(/Validated section: Stormwater 101/);
  fireEvent.press(row);
  fireEvent.press(screen.getByLabelText("Make narration"));

  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ topic_version_id: "tv-1" }));
  const sent = runMock.mock.calls[0][0];
  expect("source_text" in sent).toBe(false);
});

it("shows the add-key message when known-not-Pro and no key", async () => {
  mockAudioHook({ status: "failed", error: "No API key saved. Go to Settings and paste your OpenAI key." });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Audio"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("does not regress the existing text-post mode", async () => {
  render(<PostsScreen />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByLabelText("Make posts")).toBeTruthy();
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
});
