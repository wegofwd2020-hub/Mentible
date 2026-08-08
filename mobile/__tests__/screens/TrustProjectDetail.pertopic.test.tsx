import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const toc = {
  subjects: [
    {
      subject_label: "Fundamentals",
      units: [
        { id: "t1", title: "Topic One", subtopics: [], prerequisites: [] },
        { id: "t2", title: "Topic Two", subtopics: [], prerequisites: [] },
      ],
    },
  ],
};

const topicStatus = [
  { topic_id: "t1", status: "drafted", latest_version_id: "tv1", version_no: 1 },
  { topic_id: "t2", status: "not_generated" },
];

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const base = (opts: { withToc?: boolean; role?: string } = {}) => {
  const withToc = opts.withToc ?? true;
  return {
    project: {
      project: { id: "p1", title: "Stormwater", topic: null, toc: withToc ? toc : undefined },
      my_role: opts.role ?? "owner",
      artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
      inputs: sourceInputs,
      topic_status: withToc ? topicStatus : [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    approve: jest.fn(),
    addArtifact: jest.fn(),
    generateVersion: jest.fn(),
    generateFormat: jest.fn(),
    generateTopic: jest.fn().mockResolvedValue({ id: "tv2" }),
    invite: jest.fn(),
    addInput: jest.fn(),
    inputs: sourceInputs,
  };
};

beforeEach(() => jest.clearAllMocks());

it("shows a Per topic mode toggle when the project has a TOC", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  expect(await screen.findByLabelText("Per topic")).toBeTruthy();
  expect(screen.getByLabelText("Whole book")).toBeTruthy();
});

it("switching to Per topic shows topics grouped under their subject with a status chip each", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByText("Fundamentals")).toBeTruthy();
  expect(screen.getByText("Topic One")).toBeTruthy();
  expect(screen.getByText("Topic Two")).toBeTruthy();
  expect(screen.getByText(/drafted/i)).toBeTruthy();
  expect(screen.getByText(/not generated/i)).toBeTruthy();
});

it("pressing Generate on an ungenerated topic calls generateTopic", async () => {
  const mock = base();
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  fireEvent.press(await screen.findByLabelText("Generate Topic Two"));
  await waitFor(() => {
    expect(mock.generateTopic).toHaveBeenCalledWith("t2");
  });
});

it("pressing Open on a drafted topic navigates to the topic-version viewer", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  fireEvent.press(await screen.findByLabelText("Open Topic One"));
  expect(mockPush).toHaveBeenCalledWith("/trust/topic-version/tv1");
});

it("shows no Per topic control when the project has no TOC", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ withToc: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  await screen.findByLabelText("Generate LinkedIn post");
  expect(screen.queryByLabelText("Per topic")).toBeNull();
  expect(screen.queryByLabelText("Whole book")).toBeNull();
});

it("reviewer sees the toggle, status, and Open, but no Generate button", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ role: "reviewer" }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByLabelText("Open Topic One")).toBeTruthy();
  expect(screen.queryByLabelText("Generate Topic Two")).toBeNull();
  expect(screen.queryByLabelText("Regenerate Topic One")).toBeNull();
});
