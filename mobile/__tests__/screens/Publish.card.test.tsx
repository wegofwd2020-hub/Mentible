import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/hooks/useMakeCard", () => ({ useMakeCard: jest.fn() }));
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

const CARD_RESULT = {
  card: { headline: "Detention basins", subtext: "The short version.", source_label: "Stormwater 101" },
  size: "square",
  image_png_base64: "AAA",
  provenance: "ai-generated",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostHook();
  mockCardHook();
  (useAuth as jest.Mock).mockReturnValue({ accessToken: "token-x", status: "signed_in" });
  (listOwnedProjects as jest.Mock).mockResolvedValue([VALIDATED_PROJECT]);
  (getProject as jest.Mock).mockResolvedValue(VALIDATED_PROJECT_DETAIL);
});

it("switching to Image card mode shows the size selector and source field", async () => {
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  expect(await screen.findByLabelText("Card source text")).toBeTruthy();
  expect(screen.getByLabelText("Size: Square")).toBeTruthy();
  expect(screen.getByLabelText("Size: LinkedIn")).toBeTruthy();
  expect(screen.getByLabelText("Size: Story")).toBeTruthy();
});

it("Make card with source text calls run with source_text and size", async () => {
  const runMock = jest.fn();
  mockCardHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Card source text"), "Detention basins hold stormwater.");
  fireEvent.press(screen.getByLabelText("Make card"));
  expect(runMock).toHaveBeenCalledWith(
    expect.objectContaining({ source_text: "Detention basins hold stormwater.", size: "square" }),
  );
});

it("renders the image, headline copy and Download button for a returned card", async () => {
  mockCardHook({ status: "done", result: CARD_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  const img = screen.getByLabelText("Card preview");
  expect(img.props.source.uri).toBe(`data:image/png;base64,${CARD_RESULT.image_png_base64}`);
  expect(screen.getByText("Detention basins")).toBeTruthy();
  expect(screen.getByText("The short version.")).toBeTruthy();
  expect(screen.getByText("Stormwater 101")).toBeTruthy();
  expect(screen.getByLabelText("Download card")).toBeTruthy();
});

it("picking a validated section calls run with topic_version_id, not source_text", async () => {
  const runMock = jest.fn();
  mockCardHook({ run: runMock });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  fireEvent.press(screen.getByLabelText("Card source: Pick a validated section"));

  const row = await screen.findByLabelText(/Validated section: Stormwater 101/);
  fireEvent.press(row);
  fireEvent.press(screen.getByLabelText("Make card"));

  expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ topic_version_id: "tv-1", size: "square" }));
  const sent = runMock.mock.calls[0][0];
  expect("source_text" in sent).toBe(false);
});

it("shows a hint instead of a picker when there are no validated sections", async () => {
  (listOwnedProjects as jest.Mock).mockResolvedValue([]);
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  fireEvent.press(screen.getByLabelText("Card source: Pick a validated section"));
  expect(await screen.findByText(/no validated sections/i)).toBeTruthy();
});

it("shows the add-key message when known-not-Pro and no key", async () => {
  mockCardHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("pressing Download saves the card image", async () => {
  mockCardHook({ status: "done", result: CARD_RESULT });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Mode: Image card"));
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
  fireEvent.press(screen.getByLabelText("Download card"));
  await waitFor(() => expect(downloadArtifact).toHaveBeenCalled());
});

it("does not regress the existing text-post mode", async () => {
  render(<PostsScreen />);
  expect(screen.getByLabelText("Source text")).toBeTruthy();
  expect(screen.getByLabelText("Make posts")).toBeTruthy();
  await waitFor(() => expect(listOwnedProjects).toHaveBeenCalled());
});
