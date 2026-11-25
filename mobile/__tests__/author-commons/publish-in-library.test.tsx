import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/TopicReadList", () => ({ TopicReadList: () => null }));
jest.mock("@/components/BookEditor", () => ({ BookEditor: () => null }));
jest.mock("@/components/SaveToLibraryButton", () => ({ SaveToLibraryButton: () => null }));
jest.mock("@/components/ExportBookJsonButton", () => ({ ExportBookJsonButton: () => null }));
jest.mock("@/components/ShareDraftModal", () => ({ ShareDraftModal: () => null }));
jest.mock("@/components/GenerateAllNarration", () => ({ GenerateAllNarration: () => null }));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));

import { loadBook } from "@/storage/bookStore";
import { BookMetadataModal } from "@/components/BookMetadataModal";
import SavedBookScreen from "@/../app/book/saved/[id]";
import type { BookExportStatus } from "@/storage/exportStatus";

const LABEL = "Publish book to Author Commons";

function renderModal(exportStatus?: BookExportStatus) {
  return render(
    <BookMetadataModal
      visible
      book={null}
      meta={{ title: "My Book" }}
      exportStatus={exportStatus}
      publishBookId="b1"
      onRead={jest.fn()}
      onClose={jest.fn()}
    />,
  );
}

describe("Publish lives in the Library window", () => {
  it("library shows Publish only for a book with an exported EPUB or PDF", () => {
    renderModal(undefined);
    expect(screen.getByText("Export EPUB or PDF first")).toBeTruthy();
    expect(screen.getByLabelText(LABEL).props.accessibilityState?.disabled).toBe(true);
    screen.unmount();

    renderModal({ pdf: { state: "done", compiledAt: "2026-01-01T00:00:00.000Z" } });
    expect(screen.queryByText("Export EPUB or PDF first")).toBeNull();
    expect(screen.getByLabelText(LABEL).props.accessibilityState?.disabled).toBe(false);
  });

  it("a failed or still-generating export does not enable Publish", () => {
    renderModal({ epub: { state: "failed" }, pdf: { state: "generating" } });
    expect(screen.getByText("Export EPUB or PDF first")).toBeTruthy();
  });

  it("saved-book screen no longer renders PublishButton", async () => {
    (loadBook as jest.Mock).mockResolvedValue({
      id: "b1",
      title: "Some Book",
      toc: { subjects: [] },
      createdAt: "2026-01-01",
      source: "user",
    });
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByLabelText("Generate all topics")).toBeTruthy());
    expect(screen.queryByLabelText(/^Publish book to/)).toBeNull();
  });
});
