import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// Imported books (Open Shelves F1, ADR-028 D2) are read-only third-party
// content: editing/regenerating rewrites text that isn't ours to rewrite, and
// SaveToLibraryButton/PublishButton both compile via the same
// buildCompilePayload egress that carries book.chapters to our backend/Open
// Library. This screen's authoring + publish stack must not be reachable for
// an imported book. Read/navigation (TopicReadList) and local export stay.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/TopicReadList", () => ({
  TopicReadList: () => {
    const { Text } = require("react-native");
    return <Text>INDEX</Text>;
  },
}));
jest.mock("@/components/BookEditor", () => ({
  BookEditor: () => {
    const { Text } = require("react-native");
    return <Text>EDITOR</Text>;
  },
}));
jest.mock("@/components/SaveToLibraryButton", () => ({
  SaveToLibraryButton: () => {
    const { Text } = require("react-native");
    return <Text>SAVE_TO_LIBRARY</Text>;
  },
}));
jest.mock("@/components/PublishButton", () => ({
  PublishButton: () => {
    const { Text } = require("react-native");
    return <Text>PUBLISH</Text>;
  },
}));
jest.mock("@/components/ExportBookJsonButton", () => ({
  ExportBookJsonButton: () => {
    const { Text } = require("react-native");
    return <Text>EXPORT_JSON</Text>;
  },
}));
jest.mock("@/components/ShareDraftModal", () => ({
  ShareDraftModal: () => null,
}));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));

import { loadBook } from "@/storage/bookStore";
import SavedBookScreen from "@/../app/book/saved/[id]";

const baseBook = {
  id: "b1",
  title: "Some Book",
  toc: { subjects: [] },
  createdAt: "2026-01-01",
};

describe("imported book", () => {
  beforeEach(() => {
    (loadBook as jest.Mock).mockResolvedValue({ ...baseBook, source: "imported" });
  });

  it("hides BookEditor", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
    expect(screen.queryByText("EDITOR")).toBeNull();
  });

  it("hides the Generate all topics action", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
    expect(screen.queryByLabelText("Generate all topics")).toBeNull();
  });

  it("hides SaveToLibraryButton", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
    expect(screen.queryByText("SAVE_TO_LIBRARY")).toBeNull();
  });

  it("hides PublishButton", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
    expect(screen.queryByText("PUBLISH")).toBeNull();
  });

  it("hides the Share draft action (POSTs book.chapters — same ADR-028 D2 egress)", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
    expect(screen.queryByLabelText("Share this draft")).toBeNull();
  });

  it("keeps TopicReadList (read/navigation)", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
  });

  it("keeps ExportBookJsonButton (local export)", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("EXPORT_JSON")).toBeTruthy());
  });
});

describe("user-authored book", () => {
  beforeEach(() => {
    (loadBook as jest.Mock).mockResolvedValue({ ...baseBook, source: "user" });
  });

  it("shows BookEditor, Generate, SaveToLibraryButton, PublishButton", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("EDITOR")).toBeTruthy());
    expect(screen.getByLabelText("Generate all topics")).toBeTruthy();
    expect(screen.getByText("SAVE_TO_LIBRARY")).toBeTruthy();
    expect(screen.getByText("PUBLISH")).toBeTruthy();
  });

  it("shows the Share draft action when a token is available", async () => {
    render(<SavedBookScreen />);
    await waitFor(() => expect(screen.getByText("EDITOR")).toBeTruthy());
    expect(screen.getByLabelText("Share this draft")).toBeTruthy();
  });
});
