import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
jest.mock("@/components/PageContainer", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/api/client", () => ({
  getSharedDraft: jest.fn(),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn().mockResolvedValue({}),
}));
jest.mock("@/components/TopicReadList", () => ({
  TopicReadList: ({ book, onOpen }: { book: { title: string }; onOpen: (id: string) => void }) => {
    const { Text, Pressable } = require("react-native");
    return <Pressable accessibilityLabel="open-topic" onPress={() => onOpen("t1")}><Text>INDEX:{book.title}</Text></Pressable>;
  },
}));
jest.mock("@/components/LessonRenderer", () => ({
  TopicRenderer: ({ topic }: { topic: { label: string } }) => {
    const { Text } = require("react-native");
    return <Text>TOPIC:{topic.label}</Text>;
  },
}));
import * as api from "@/api/client";
import SharedDraftReader from "@/../app/book/shared/[id]";

const draft = { book_json: { id: "b1", title: "Shared Book", toc: { subjects: [] }, content: { t1: { label: "Chapter One" } } }, title: "Shared Book", version: "1.0", access: "invited" };

beforeEach(() => {
  jest.clearAllMocks();
  (api.listComments as jest.Mock).mockResolvedValue([]);
  (api.getSharedDraft as jest.Mock).mockResolvedValue(draft);
});

it("loads the draft and renders its contents", async () => {
  render(<SharedDraftReader />);
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
});

it("opens a topic full-screen and returns to contents", async () => {
  render(<SharedDraftReader />);
  fireEvent.press(await screen.findByLabelText("open-topic"));
  await waitFor(() => expect(screen.getByText("TOPIC:Chapter One")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Back to contents"));
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
});

it("shows an error when the draft can't be loaded", async () => {
  (api.getSharedDraft as jest.Mock).mockRejectedValue(new Error("nope"));
  render(<SharedDraftReader />);
  await waitFor(() => expect(screen.getByText(/Couldn't load this draft/i)).toBeTruthy());
});

it("posts a comment from the contents view", async () => {
  render(<SharedDraftReader />);
  await screen.findByText("INDEX:Shared Book");
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "nice");
  fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(api.postComment).toHaveBeenCalledWith("b1", "1.0", "nice", "tok"));
});
