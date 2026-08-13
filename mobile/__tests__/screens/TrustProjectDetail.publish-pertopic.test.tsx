import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// plan:null (fail-open) — unrelated to this test's assertions; without this
// mock PublishPanel's useBillingPlan() would call the real useAuth(), which
// throws outside an AuthProvider.
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
const mockSaveBook = jest.fn(async (_b: unknown) => {});
jest.mock("@/storage/bookStore", () => ({ saveBook: (b: unknown) => mockSaveBook(b) }));
const mockTrackedExport = jest.fn(async (_book: unknown, _fmt: string, _opts: unknown) => ({ artifact: new ArrayBuffer(8) }));
jest.mock("@/lib/trackedExport", () => ({ trackedExport: (book: unknown, fmt: string, opts: unknown) => mockTrackedExport(book, fmt, opts) }));
const mockDownloadArtifact = jest.fn(async (_bytes: ArrayBuffer, _filename: string, _mime: string) => ({}));
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (bytes: ArrayBuffer, filename: string, mime: string) => mockDownloadArtifact(bytes, filename, mime),
}));
const mockGetTopicVersion = jest.fn(async (id: string) => {
  const bySections: Record<string, { heading: string; body: string; source_ids: string[] }[]> = {
    tv1: [{ heading: "H1", body: "Body one", source_ids: [] }],
    tv2: [{ heading: "H2", body: "Body two", source_ids: [] }],
  };
  return {
    id, topic_id: id === "tv1" ? "t1" : "t2", title: id === "tv1" ? "Topic One" : "Topic Two",
    content: { sections: bySections[id] ?? [] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self",
  };
});
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: (id: string) => mockGetTopicVersion(id),
  // Task 6's on-return progress poller — this file doesn't exercise it, but
  // the screen calls it unconditionally on focus whenever accessToken is set.
  getGenerationJob: jest.fn().mockResolvedValue(null),
  latestGenerationJob: jest.fn().mockResolvedValue(null),
}));
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
  { topic_id: "t2", status: "validated", latest_version_id: "tv2", version_no: 1 },
];

const sourceInputs = [
  { id: "i1", kind: "note", title: "Kickoff notes", content: "We discussed scope.", source_ref: null, created_at: "2026-07-01T00:00:00Z" },
];

const base = (opts: { withToc?: boolean; role?: string; bookValidated?: boolean } = {}) => {
  const withToc = opts.withToc ?? true;
  return {
    project: {
      project: { id: "p1", title: "Stormwater", topic: null, toc: withToc ? toc : undefined },
      my_role: opts.role ?? "owner",
      artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
      inputs: sourceInputs,
      topic_status: withToc ? topicStatus : [],
      book_validated: opts.bookValidated ?? true,
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
    accessToken: "tok",
  };
};

beforeEach(() => jest.clearAllMocks());

it("shows a Per topic mode toggle on Publish when the project has a TOC", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  expect(await screen.findByLabelText("Per topic")).toBeTruthy();
  expect(screen.getByLabelText("Whole book")).toBeTruthy();
});

it("per-topic view shows the rollup and a Publish/Add-to-Library control", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base());
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByText("2/2 topics validated")).toBeTruthy();
  expect(screen.getByLabelText("Add book to Library")).toBeTruthy();
  expect(screen.getByLabelText("Download book as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download book as PDF")).toBeTruthy();
});

it("book_validated:true — Add to Library assembles topics then saves the book", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ bookValidated: true }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  fireEvent.press(await screen.findByLabelText("Add book to Library"));

  await waitFor(() => expect(mockGetTopicVersion).toHaveBeenCalledWith("tv1"));
  await waitFor(() => expect(mockGetTopicVersion).toHaveBeenCalledWith("tv2"));
  await waitFor(() => expect(mockSaveBook).toHaveBeenCalled());

  const savedBook = mockSaveBook.mock.calls[0][0] as {
    toc: { subjects: { units: { id: string; title: string }[] }[] };
  };
  const units = savedBook.toc.subjects.flatMap((s) => s.units);
  expect(units).toHaveLength(2);
  expect(units.map((u) => u.title).sort()).toEqual(["Topic One", "Topic Two"]);
});

it("book_validated:false — Publish actions are disabled with a validate-first hint", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(base({ bookValidated: false }));
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  expect(await screen.findByText(/Validate all topics first/i)).toBeTruthy();
  const addBtn = screen.getByLabelText("Add book to Library");
  expect(addBtn.props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(addBtn);
  expect(mockSaveBook).not.toHaveBeenCalled();
});

it("a project with no TOC shows no Per topic control; whole-book Publish unchanged", async () => {
  (useTrustProject as jest.Mock).mockReturnValue({
    ...base({ withToc: false }),
    project: {
      ...base({ withToc: false }).project,
      artifacts: [{ artifact: { id: "art", title: "Guide", role: "derivative", format: "linkedin" }, versions: [] }],
    },
  });
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.queryByLabelText("Per topic")).toBeNull();
  expect(screen.queryByLabelText("Whole book")).toBeNull();
  expect(screen.getByText(/approve a version under Feedback/i)).toBeTruthy();
});
