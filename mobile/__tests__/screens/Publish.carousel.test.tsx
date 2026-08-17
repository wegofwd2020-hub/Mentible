import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/hooks/useMakeCard", () => ({ useMakeCard: jest.fn() }));
jest.mock("@/hooks/useMakeCarousel", () => ({ useMakeCarousel: jest.fn() }));
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

const CAROUSEL_RESULT = {
  frames: [
    { card: { headline: "Frame one", subtext: "First frame body.", source_label: "Stormwater 101" }, image_png_base64: "AAA" },
    { card: { headline: "Frame two", subtext: "Second frame body.", source_label: "Stormwater 101" }, image_png_base64: "BBB" },
    { card: { headline: "Frame three", subtext: "Third frame body.", source_label: "Stormwater 101" }, image_png_base64: "CCC" },
  ],
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostHook();
  mockCardHook();
  mockCarouselHook();
  (useAuth as jest.Mock).mockReturnValue({ accessToken: "token-x", status: "signed_in" });
  (listOwnedProjects as jest.Mock).mockResolvedValue([VALIDATED_PROJECT]);
  (getProject as jest.Mock).mockResolvedValue(VALIDATED_PROJECT_DETAIL);
});

it("switching to Carousel mode shows the source field", async () => {
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  expect(await screen.findByLabelText("Card source text")).toBeTruthy();
});

it("Make carousel with source text calls makeCarousel with source_text", async () => {
  const runMock = jest.fn();
  mockCarouselHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Card source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Make carousel"));
  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ source_text: "Detention basins hold stormwater." }),
  );
  const sent = runMock.mock.calls[0][0];
  expect("size" in sent).toBe(false);
});

it("renders 3 frame images and headlines plus a Download all button for a 3-frame result", async () => {
  mockCarouselHook({ status: "done", result: CAROUSEL_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());

  const img1 = screen.getByLabelText("Carousel frame 1 preview");
  const img2 = screen.getByLabelText("Carousel frame 2 preview");
  const img3 = screen.getByLabelText("Carousel frame 3 preview");
  expect(img1.props.source.uri).toBe("data:image/png;base64,AAA");
  expect(img2.props.source.uri).toBe("data:image/png;base64,BBB");
  expect(img3.props.source.uri).toBe("data:image/png;base64,CCC");

  expect(screen.getByText("Frame one")).toBeTruthy();
  expect(screen.getByText("Frame two")).toBeTruthy();
  expect(screen.getByText("Frame three")).toBeTruthy();

  expect(screen.getByLabelText("Download all")).toBeTruthy();
});

it("pressing Download all downloads every frame as image/png", async () => {
  mockCarouselHook({ status: "done", result: CAROUSEL_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText("Download all"));
  await waitFor(() => expect(downloadArtifact).toHaveBeenCalledTimes(3));
  expect(downloadArtifact).toHaveBeenNthCalledWith(1, expect.anything(), "frame-1.png", "image/png");
  expect(downloadArtifact).toHaveBeenNthCalledWith(2, expect.anything(), "frame-2.png", "image/png");
  expect(downloadArtifact).toHaveBeenNthCalledWith(3, expect.anything(), "frame-3.png", "image/png");
});

it("picking a validated section calls makeCarousel with topic_version_id, not source_text", async () => {
  const runMock = jest.fn();
  mockCarouselHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  fireEvent.press(screen.getByLabelText("Card source: Pick a validated section"));

  const row = await screen.findByLabelText(/Validated section: Stormwater 101/);
  fireEvent.press(row);
  fireEvent.press(screen.getByLabelText("Make carousel"));

  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ topic_version_id: "tv-1" }));
  const sent = runMock.mock.calls[0][0];
  expect("source_text" in sent).toBe(false);
});

it("shows the add-key message when known-not-Pro and no key", async () => {
  mockCarouselHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Carousel"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("does not regress the existing text-post mode", async () => {
  render(<PostsScreen />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByLabelText("Make posts")).toBeTruthy();
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
});
