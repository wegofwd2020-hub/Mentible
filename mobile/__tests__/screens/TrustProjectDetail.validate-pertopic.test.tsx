import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
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
  { topic_id: "t1", status: "validated", latest_version_id: "tv1", version_no: 1 },
  { topic_id: "t2", status: "drafted", latest_version_id: "tv2", version_no: 1 },
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
      book_validated: false,
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
    generateFormat: jest.fn(),
    generateTopic: jest.fn(),
    invite: jest.fn(),
    addInput: jest.fn(),
    editInput: jest.fn(),
    removeInput: jest.fn(),
    loadVersionContent: jest.fn(),
    suggestToc: jest.fn(),
    saveToc: jest.fn(),
    inputs: sourceInputs,
  };
};

beforeEach(() => jest.clearAllMocks());

it("shows a Per topic mode toggle on Feedback when the project has a TOC", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  expect(await screen.findByLabelText("Per topic")).toBeTruthy();
  expect(screen.getByLabelText("Whole book")).toBeTruthy();
});

it("switching to Per topic shows a rollup header and a not-yet-book-validated state", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByText("1/2 topics validated")).toBeTruthy();
  expect(screen.getByText(/not yet book-validated/i)).toBeTruthy();
});

it("lists topic titles with a status badge each, grouped by subject", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByText("Fundamentals")).toBeTruthy();
  expect(screen.getByText("Topic One")).toBeTruthy();
  expect(screen.getByText("Topic Two")).toBeTruthy();
  expect(screen.getByText(/^validated$/i)).toBeTruthy();
  expect(screen.getByText(/^drafted$/i)).toBeTruthy();
});

it("pressing Open on a topic navigates to the topic-version viewer with projectId", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  fireEvent.press(await screen.findByLabelText("Open Topic One"));
  expect(mockPush).toHaveBeenCalledWith("/trust/topic-version/tv1?projectId=p1");
});

it("has no inline Approve control on the per-topic list rows", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  await screen.findByText("Topic One");
  expect(screen.queryByLabelText(/Approve/i)).toBeNull();
  expect(screen.queryByText(/^Approve$/i)).toBeNull();
});

it("shows no Per topic control on Feedback when the project has no TOC", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ withToc: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Feedback:/));
  await screen.findByText(/Finish Drafts first/i);
  expect(screen.queryByLabelText("Per topic")).toBeNull();
  expect(screen.queryByLabelText("Whole book")).toBeNull();
});
