import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

// Imported books (Open Shelves F1, ADR-028 D2) are read-only third-party
// content: CheckoutButton → trackedExport → buildCompilePayload carries
// book.chapters (raw third-party HTML) to the remote compiler, which would
// violate "our infra never hosts/mirrors/proxies a third-party file." This
// screen must not offer checkout for an imported book.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/TopicReadList", () => ({
  TopicReadList: () => {
    const { Text } = require("react-native");
    return <Text>INDEX</Text>;
  },
}));
jest.mock("@/components/CheckoutButton", () => ({
  CheckoutButton: () => {
    const { Text } = require("react-native");
    return <Text>CHECKOUT</Text>;
  },
}));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));
jest.mock("@/storage/epubLibrary", () => ({ openEpub: jest.fn() }));

import { loadBook } from "@/storage/bookStore";
import ReadBookScreen from "@/../app/book/read/[id]";

const baseBook = {
  id: "b1",
  title: "Some Book",
  toc: { subjects: [] },
};

it("hides CheckoutButton for an imported book (ADR-028 egress guard)", async () => {
  (loadBook as jest.Mock).mockResolvedValue({ ...baseBook, source: "imported" });
  render(<ReadBookScreen />);
  await waitFor(() => expect(screen.getByText("INDEX")).toBeTruthy());
  expect(screen.queryByText("CHECKOUT")).toBeNull();
});

it("shows CheckoutButton for a user-authored book", async () => {
  (loadBook as jest.Mock).mockResolvedValue({ ...baseBook, source: "user" });
  render(<ReadBookScreen />);
  await waitFor(() => expect(screen.getByText("CHECKOUT")).toBeTruthy());
});
