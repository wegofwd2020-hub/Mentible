import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
import { ApiError } from "@/api/client";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// plan:null (fail-open) — unrelated to this test's assertions; without this
// mock PublishPanel's useBillingPlan() would call the real useAuth(), which
// throws outside an AuthProvider.
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: null, loading: false }) }));
const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
const mockCopyText = jest.fn(async (_t: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (t: string) => mockCopyText(t) }));
const mockSaveBook = jest.fn(async (_b: unknown) => {});
jest.mock("@/storage/bookStore", () => ({ saveBook: (b: unknown) => mockSaveBook(b) }));
const mockTrackedExport = jest.fn(async (_book: unknown, _fmt: string, _opts: unknown) => ({ artifact: new ArrayBuffer(8) }));
jest.mock("@/lib/trackedExport", () => ({ trackedExport: (book: unknown, fmt: string, opts: unknown) => mockTrackedExport(book, fmt, opts) }));
const mockDownloadArtifact = jest.fn(async (_bytes: ArrayBuffer, _filename: string, _mime: string) => ({}));
const mockSaveEpub = jest.fn(async (_input: unknown) => ({ id: "b1" }));
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (bytes: ArrayBuffer, filename: string, mime: string) => mockDownloadArtifact(bytes, filename, mime),
  saveEpub: (input: unknown) => mockSaveEpub(input),
}));
const mockExportBook = jest.fn(async (_book: unknown, _opts: unknown) => ({ artifact: new ArrayBuffer(2) }));
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, exportBook: (book: unknown, opts: unknown) => mockExportBook(book, opts) };
});
import { useTrustProject } from "@/hooks/useTrustProject";

const loadVersionContent = jest.fn(async () => ({
  id: "v1", artifact_id: "art", version_no: 2,
  content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
  generation_meta: null, is_validated: true, recorded_via: "expert_self", created_at: null, feedback: [],
}));

const inputs = [{ id: "i" }];

const projectData = {
  project: {
    project: { id: "p1", title: "Medicare", topic: null },
    my_role: "owner",
    inputs,
    artifacts: [
      { artifact: { id: "art", title: "Chapter outline", role: "cornerstone", format: "book" }, versions: [{ id: "v1", version_no: 2, is_validated: true, recorded_via: "expert_self" }] },
      { artifact: { id: "art2", title: "LinkedIn post", role: "derivative", format: "linkedin" }, versions: [{ id: "v2", version_no: 1, is_validated: true, recorded_via: "expert_self" }] },
    ],
  },
  loading: false, error: null, refresh: jest.fn(), loadVersionContent, inputs,
};

beforeEach(() => jest.clearAllMocks());

it("long-form asset shows book actions; social asset keeps Copy", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  // long-form asset → book actions, not Copy
  expect(screen.getByLabelText("Add Chapter outline to Library")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download Chapter outline as PDF")).toBeTruthy();
  // social asset → Copy actions
  expect(screen.getByLabelText("Copy LinkedIn post as text")).toBeTruthy();

  fireEvent.press(screen.getByLabelText("Download Chapter outline as EPUB"));
  await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "epub", { diagrams: true }));
  await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.stringMatching(/\.epub$/), "application/epub+zip"));
});

it("Add to Library saves the Studio copy AND compiles+saves the book to the Library", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  fireEvent.press(screen.getByLabelText("Add Chapter outline to Library"));

  // Studio copy (kept) — the saved book has one topic with the mapped section.
  await waitFor(() => expect(mockSaveBook).toHaveBeenCalled());
  const savedBook = mockSaveBook.mock.calls[0][0] as {
    id: string;
    title: string;
    content: Record<string, { lesson: { sections: { body_markdown: string }[] } }>;
  };
  const topicId = Object.keys(savedBook.content)[0]!;
  expect(savedBook.content[topicId]!.lesson.sections[0]!.body_markdown).toBe("B");

  // Library copy: compiled EPUB via trackedExport, best-effort cover via
  // exportBook, then saveEpub — this is what makes it show up under
  // listEpubs/Library, which saveBook alone never did.
  await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "epub", { diagrams: true }));
  await waitFor(() => expect(mockSaveEpub).toHaveBeenCalledWith({
    bookId: savedBook.id,
    title: savedBook.title,
    bytes: expect.any(ArrayBuffer),
    coverBytes: expect.any(ArrayBuffer),
  }));

  // "Added" only fires after saveEpub resolves.
  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith("Added", "Added to your Library."));
  expect(mockSaveBook.mock.invocationCallOrder[0]!).toBeLessThan(mockAlert.mock.invocationCallOrder[0]!);
  expect(mockSaveEpub.mock.invocationCallOrder[0]!).toBeLessThan(mockAlert.mock.invocationCallOrder[0]!);
});

it("a 402 on the compile step shows the upgrade prompt — saveEpub not called, no Added alert", async () => {
  mockTrackedExport.mockRejectedValueOnce(new ApiError(402, JSON.stringify({ detail: "Pro plan required" })));
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  fireEvent.press(screen.getByLabelText("Add Chapter outline to Library"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Upgrade to Pro");
  expect(mockSaveEpub).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalledWith("Added", expect.anything());
});

it("a generic compile failure shows Couldn't add — saveEpub not called, no Added alert", async () => {
  mockTrackedExport.mockRejectedValueOnce(new Error("network down"));
  (useTrustProject as jest.Mock).mockReturnValue(projectData);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Publish:/));

  fireEvent.press(screen.getByLabelText("Add Chapter outline to Library"));

  await waitFor(() => expect(mockAlert).toHaveBeenCalled());
  const [title] = mockAlert.mock.calls[0] as [string, string];
  expect(title).toBe("Couldn't add");
  expect(mockSaveEpub).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalledWith("Added", expect.anything());
});
