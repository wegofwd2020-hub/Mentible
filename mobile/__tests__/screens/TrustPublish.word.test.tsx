import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

// Word download (T5): a per-format gate independent of the whole-group Pro
// wall (publish-prowall). A Pro user whose plan.features includes
// "export_docx" gets a Download Word button beside EPUB/PDF, in both the
// per-asset long-form block and the whole-book (Per topic) block; a Pro user
// without that feature (or a Free user, walled entirely) does not.

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => cb(),
}));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));

let mockPlan: { is_pro: boolean; features: string[] } | null = null;
jest.mock("@/hooks/useBillingPlan", () => ({
  useBillingPlan: () => ({ plan: mockPlan, loading: false }),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

const mockSaveBook = jest.fn(async (_b: unknown) => {});
jest.mock("@/storage/bookStore", () => ({ saveBook: (b: unknown) => mockSaveBook(b) }));
const mockTrackedExport = jest.fn(async (_book: unknown, _fmt: string, _opts: unknown) => ({ artifact: new ArrayBuffer(8) }));
jest.mock("@/lib/trackedExport", () => ({ trackedExport: (book: unknown, fmt: string, opts: unknown) => mockTrackedExport(book, fmt, opts) }));
const mockDownloadArtifact = jest.fn(async (_bytes: ArrayBuffer, _filename: string, _mime: string) => ({}));
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (bytes: ArrayBuffer, filename: string, mime: string) => mockDownloadArtifact(bytes, filename, mime),
  saveEpub: jest.fn(async () => ({ id: "b1" })),
}));
const mockExportBook = jest.fn(async (_book: unknown, _opts: unknown) => ({ artifact: new ArrayBuffer(2) }));
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, exportBook: (book: unknown, opts: unknown) => mockExportBook(book, opts) };
});
const mockGetTopicVersion = jest.fn(async (id: string) => ({
  id, topic_id: id === "tv1" ? "t1" : "t2", title: id === "tv1" ? "Topic One" : "Topic Two",
  content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
  version_no: 1, created_at: null, is_validated: true, recorded_via: "expert_self",
}));
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: (id: string) => mockGetTopicVersion(id),
  getGenerationJob: jest.fn().mockResolvedValue(null),
  latestGenerationJob: jest.fn().mockResolvedValue(null),
}));

import { useTrustProject } from "@/hooks/useTrustProject";

const loadVersionContent = jest.fn(async () => ({
  id: "v1", artifact_id: "art", version_no: 2,
  content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
  generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null, feedback: [],
}));

const inputs = [{ id: "i" }];

// Per-asset (no TOC) fixture — mirrors publish-prowall/publishbook.
const perAssetProject = {
  project: {
    project: { id: "p1", title: "Medicare", topic: null },
    my_role: "owner",
    inputs,
    artifacts: [
      { artifact: { id: "art", title: "Chapter outline", role: "cornerstone", format: "book" }, versions: [{ id: "v1", version_no: 2, is_validated: true, recorded_via: "expert_self" }] },
    ],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent, inputs,
  accessToken: "tok",
};

// Whole-book (TOC) fixture — mirrors publish-pertopic.
const toc = {
  subjects: [
    { subject_label: "Fundamentals", units: [{ id: "t1", title: "Topic One", subtopics: [], prerequisites: [] }] },
  ],
};
const topicStatus = [{ topic_id: "t1", status: "validated", latest_version_id: "tv1", version_no: 1 }];
const wholeBookProject = {
  project: {
    project: { id: "p1", title: "Stormwater", topic: null, toc },
    my_role: "owner",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" }, versions: [] }],
    inputs,
    topic_status: topicStatus,
    book_validated: true,
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent: jest.fn(), inputs,
  generateFormat: jest.fn(), generateTopic: jest.fn(), invite: jest.fn(),
  addInput: jest.fn(), editInput: jest.fn(), removeInput: jest.fn(),
  suggestToc: jest.fn(), saveToc: jest.fn(),
  accessToken: "tok",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = null;
});

it("Pro plan with export_docx — Download Word renders (per-asset) and submits format docx", async () => {
  mockPlan = { is_pro: true, features: ["export_docx", "export_epub", "export_pdf"] };
  (useTrustProject as jest.Mock).mockReturnValue(perAssetProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  const wordBtn = screen.getByLabelText("Download Chapter outline as Word");
  expect(wordBtn).toBeTruthy();
  // EPUB/PDF are unaffected by the per-format gate.
  expect(screen.getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as PDF")).toBeTruthy();

  fireEvent.press(wordBtn);
  await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "docx", { diagrams: true }));
  await waitFor(() =>
    expect(mockDownloadArtifact).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.stringMatching(/\.docx$/),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
});

it("Pro plan WITHOUT export_docx — Download Word is absent (per-asset); EPUB/PDF still present", async () => {
  mockPlan = { is_pro: true, features: ["export_epub", "export_pdf"] };
  (useTrustProject as jest.Mock).mockReturnValue(perAssetProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.queryByLabelText("Download Chapter outline as Word")).toBeNull();
  expect(screen.getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as PDF")).toBeTruthy();
});

it("Free plan — walled entirely; no Download Word, no Download EPUB/PDF, just Upgrade", async () => {
  mockPlan = { is_pro: false, features: [] };
  (useTrustProject as jest.Mock).mockReturnValue(perAssetProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.queryByLabelText("Download Chapter outline as Word")).toBeNull();
  expect(screen.queryByLabelText("Download Chapter outline as EPUB")).toBeNull();
  expect(screen.getByLabelText("Upgrade to Pro to download Chapter outline")).toBeTruthy();
});

it("unknown plan (fetch failed / signed out) — fails open, Download Word renders", async () => {
  mockPlan = null;
  (useTrustProject as jest.Mock).mockReturnValue(perAssetProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  expect(screen.getByLabelText("Download Chapter outline as Word")).toBeTruthy();
});

it("whole-book (Per topic) — Download Word renders when entitled and submits format docx", async () => {
  mockPlan = { is_pro: true, features: ["export_docx", "export_epub", "export_pdf"] };
  (useTrustProject as jest.Mock).mockReturnValue(wholeBookProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  const wordBtn = await screen.findByLabelText("Download book as Word");
  expect(wordBtn).toBeTruthy();
  expect(screen.getByLabelText("Download book as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download book as PDF")).toBeTruthy();

  fireEvent.press(wordBtn);
  await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "docx", { diagrams: true }));
  await waitFor(() =>
    expect(mockDownloadArtifact).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.stringMatching(/\.docx$/),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
});

it("whole-book (Per topic) — Pro without export_docx has no Download Word", async () => {
  mockPlan = { is_pro: true, features: ["export_epub", "export_pdf"] };
  (useTrustProject as jest.Mock).mockReturnValue(wholeBookProject);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));

  await screen.findByLabelText("Download book as EPUB");
  expect(screen.queryByLabelText("Download book as Word")).toBeNull();
});
