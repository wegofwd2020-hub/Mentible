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

// #320: a shared draft carries figure REFS (book_json) but never the bytes, and
// the reader passes no `figures` prop — so figures used to vanish without a
// trace on the one surface whose purpose is feedback. The notice is the fix;
// shipping the bytes is NOT (ADR-035 D4 fences figure distribution).
describe("figures notice (#320)", () => {
  const withImages = (images: unknown[]) => ({
    ...draft,
    book_json: {
      ...draft.book_json,
      content: { t1: { label: "Chapter One", images } },
    },
  });
  const img = (id: string) => ({ id, file: `media/b1/${id}.jpg`, mime: "image/jpeg", addedAt: "x" });

  it("tells the reviewer figures aren't included, pluralised", async () => {
    (api.getSharedDraft as jest.Mock).mockResolvedValue(withImages([img("a"), img("b"), img("c")]));
    render(<SharedDraftReader />);
    fireEvent.press(await screen.findByLabelText("open-topic"));
    expect(await screen.findByText(/3 figures aren't included in shared drafts/i)).toBeTruthy();
  });

  it("uses the singular for one figure", async () => {
    (api.getSharedDraft as jest.Mock).mockResolvedValue(withImages([img("a")]));
    render(<SharedDraftReader />);
    fireEvent.press(await screen.findByLabelText("open-topic"));
    expect(await screen.findByText(/1 figure isn't included in shared drafts/i)).toBeTruthy();
  });

  it("says nothing when the topic has no figures", async () => {
    render(<SharedDraftReader />); // base draft: topic t1 has no `images` key
    fireEvent.press(await screen.findByLabelText("open-topic"));
    await screen.findByText("TOPIC:Chapter One");
    expect(screen.queryByText(/aren't included in shared drafts/i)).toBeNull();
    expect(screen.queryByText(/isn't included in shared drafts/i)).toBeNull();
  });
});

it("posts a comment from the contents view", async () => {
  render(<SharedDraftReader />);
  await screen.findByText("INDEX:Shared Book");
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "nice");
  fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(api.postComment).toHaveBeenCalledWith("b1", "1.0", "nice", "tok"));
});
