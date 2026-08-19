import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/hooks/useMakeCard", () => ({ useMakeCard: jest.fn() }));
jest.mock("@/hooks/useMakeCarousel", () => ({ useMakeCarousel: jest.fn() }));
jest.mock("@/hooks/useMakeAnimated", () => ({ useMakeAnimated: jest.fn() }));
jest.mock("@/hooks/useMakeAudio", () => ({ useMakeAudio: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));
jest.mock("@/lib/pickReferenceImage", () => ({ pickReferenceImage: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/api/trustClient", () => ({
  listOwnedProjects: jest.fn(),
  getProject: jest.fn(),
}));
jest.mock("@/storage/epubLibrary", () => ({ downloadArtifact: jest.fn().mockResolvedValue({}) }));

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
    status: "idle", error: null, result: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

function mockCarouselHook(over: Record<string, unknown> = {}) {
  (useMakeCarousel as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

function mockAnimatedHook(over: Record<string, unknown> = {}) {
  (useMakeAnimated as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

function mockAudioHook(over: Record<string, unknown> = {}) {
  (useMakeAudio as jest.Mock).mockReturnValue({
    status: "idle", error: null, result: null,
    run: jest.fn(), reset: jest.fn(), ...over,
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

const ANIMATED_RESULT = {
  card: { headline: "Detention basins", subtext: "Hold stormwater.", source_label: "Stormwater 101" },
  preset: "fade",
  image_gif_base64: "R0lGODlhAQABAAAAACw=",
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

it("switching to Animated mode shows the source field and preset selector", async () => {
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  expect(await screen.findByLabelText("Animated source text")).toBeTruthy();
  expect(screen.getByLabelText("Preset: Fade")).toBeTruthy();
  expect(screen.getByLabelText("Preset: Slide-up")).toBeTruthy();
  expect(screen.getByLabelText("Preset: Build-in")).toBeTruthy();
});

it("Make animated card with source text calls makeAnimated with source_text and preset fade", async () => {
  const runMock = jest.fn();
  mockAnimatedHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Animated source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Make animated card"));
  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ source_text: "Detention basins hold stormwater.", preset: "fade" }),
  );
});

it("selecting Slide-up then Make sends preset slide", async () => {
  const runMock = jest.fn();
  mockAnimatedHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Animated source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Preset: Slide-up"));
  fireEvent.press(screen.getByLabelText("Make animated card"));
  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ preset: "slide" }));
});

it("renders the GIF preview and headline/subtext for a returned result, with a Download button", async () => {
  mockAnimatedHook({ status: "done", result: ANIMATED_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());

  const img = screen.getByLabelText("Animated card preview");
  // expo-image normalizes `source` into an array of resolved sources.
  expect(img.props.source[0].uri).toBe(`data:image/gif;base64,${ANIMATED_RESULT.image_gif_base64}`);
  expect(screen.getByText("Detention basins")).toBeTruthy();
  expect(screen.getByText("Hold stormwater.")).toBeTruthy();
  expect(screen.getByLabelText("Download animated card")).toBeTruthy();
});

it("pressing Download calls downloadArtifact with image/gif", async () => {
  mockAnimatedHook({ status: "done", result: ANIMATED_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText("Download animated card"));
  await waitFor(() => expect(downloadArtifact).toHaveBeenCalledWith(expect.anything(), "card.gif", "image/gif"));
});

it("picking a validated section calls makeAnimated with topic_version_id, not source_text", async () => {
  const runMock = jest.fn();
  mockAnimatedHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  fireEvent.press(screen.getByLabelText("Animated source: Pick a validated section"));

  const row = await screen.findByLabelText(/Validated section: Stormwater 101/);
  fireEvent.press(row);
  fireEvent.press(screen.getByLabelText("Make animated card"));

  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ topic_version_id: "tv-1" }));
  const sent = runMock.mock.calls[0][0];
  expect("source_text" in sent).toBe(false);
});

it("shows the add-key message when known-not-Pro and no key", async () => {
  mockAnimatedHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Animated"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("does not regress the existing text-post mode", async () => {
  render(<PostsScreen />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByLabelText("Make posts")).toBeTruthy();
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
});
