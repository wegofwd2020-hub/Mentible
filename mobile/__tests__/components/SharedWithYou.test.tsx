import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SharedWithYou } from "@/components/SharedWithYou";

jest.mock("@/api/client", () => ({
  sharedWithMe: jest.fn(),
  getSharedDraft: jest.fn(),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn(),
}));

// Light stand-ins so we assert the read-view wiring without pulling in the
// WebView-backed real renderer.
jest.mock("@/components/TopicReadList", () => ({
  TopicReadList: ({ book, onOpen }: { book: { title: string }; onOpen: (id: string) => void }) => {
    const { Text, Pressable } = require("react-native");
    return (
      <Pressable accessibilityLabel="mock-open-topic" onPress={() => onOpen("t1")}>
        <Text>INDEX:{book.title}</Text>
      </Pressable>
    );
  },
}));
jest.mock("@/components/LessonRenderer", () => ({
  TopicRenderer: ({ topic }: { topic: { label: string } }) => {
    const { Text } = require("react-native");
    return <Text>TOPIC:{topic.label}</Text>;
  },
}));
import * as api from "@/api/client";

const draftBook = {
  id: "b1",
  title: "Shared Book",
  toc: { subjects: [] },
  content: { t1: { label: "Chapter One" } },
};

beforeEach(() => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([
    { book_id: "b1", title: "Shared Book", owner_sub: "o", version: "1.0", updated_at: "" },
  ]);
  (api.getSharedDraft as jest.Mock).mockResolvedValue({
    book_json: draftBook,
    title: "Shared Book",
    version: "1.0",
    access: "invited",
  });
});

it("renders nothing when signed out", () => {
  const { toJSON } = render(<SharedWithYou token={null} />);
  expect(toJSON()).toBeNull();
});

it("lists drafts shared with me", async () => {
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(screen.getByText("Shared Book")).toBeTruthy());
});

it("renders nothing (no header) when the shared list is empty", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(api.sharedWithMe).toHaveBeenCalled());
  expect(screen.queryByText(/Shared with you/i)).toBeNull();
});

it("opens a shared draft into the topic index, then renders a topic's content", async () => {
  render(<SharedWithYou token="tok" />);
  fireEvent.press(await screen.findByLabelText("Open shared draft: Shared Book"));
  // The fetched book_json drives the topic index (reusing the reader).
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
  // Selecting a topic renders its content via the shared TopicRenderer.
  fireEvent.press(screen.getByLabelText("mock-open-topic"));
  await waitFor(() => expect(screen.getByText("TOPIC:Chapter One")).toBeTruthy());
  // A back control returns to the contents index.
  fireEvent.press(screen.getByLabelText("Back to contents"));
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
});
