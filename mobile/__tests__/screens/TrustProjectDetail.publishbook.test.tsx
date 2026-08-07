import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
const mockCopyText = jest.fn(async (_t: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (t: string) => mockCopyText(t) }));
const mockSaveBook = jest.fn(async (_b: unknown) => {});
jest.mock("@/storage/bookStore", () => ({ saveBook: (b: unknown) => mockSaveBook(b) }));
const mockTrackedExport = jest.fn(async (_book: unknown, _fmt: string, _opts: unknown) => ({ artifact: new ArrayBuffer(8) }));
jest.mock("@/lib/trackedExport", () => ({ trackedExport: (book: unknown, fmt: string, opts: unknown) => mockTrackedExport(book, fmt, opts) }));
const mockDownloadArtifact = jest.fn(async (_bytes: ArrayBuffer, _filename: string, _mime: string) => ({}));
jest.mock("@/storage/epubLibrary", () => ({
  downloadArtifact: (bytes: ArrayBuffer, filename: string, mime: string) => mockDownloadArtifact(bytes, filename, mime),
}));
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

  fireEvent.press(screen.getByLabelText("Add Chapter outline to Library"));
  await waitFor(() => expect(mockSaveBook).toHaveBeenCalled());
  // the saved book has one topic with the mapped section
  const savedBook = mockSaveBook.mock.calls[0][0] as {
    content: Record<string, { lesson: { sections: { body_markdown: string }[] } }>;
  };
  const topicId = Object.keys(savedBook.content)[0]!;
  expect(savedBook.content[topicId]!.lesson.sections[0]!.body_markdown).toBe("B");

  fireEvent.press(screen.getByLabelText("Download Chapter outline as EPUB"));
  await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "epub", { diagrams: true }));
  await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.stringMatching(/\.epub$/), "application/epub+zip"));
});
