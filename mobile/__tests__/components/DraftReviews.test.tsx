import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DraftReviews } from "@/components/DraftReviews";

jest.mock("@/api/client", () => ({ myDrafts: jest.fn() }));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/components/ShareDraftModal", () => ({
  ShareDraftModal: ({ visible, book }: { visible: boolean; book: { title: string } }) => {
    const { Text } = require("react-native");
    return visible ? <Text>MODAL:{book.title}</Text> : null;
  },
}));
const mockFocus: { run: (() => void) | null } = { run: null };
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    mockFocus.run = cb;
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import * as api from "@/api/client";
import * as store from "@/storage/bookStore";
import { Alert } from "@/lib/alert";

const rows = [{ book_id: "b1", title: "My Draft", version: "1.0", comment_count: 2, last_comment_at: null }];

beforeEach(() => {
  jest.clearAllMocks();
  (api.myDrafts as jest.Mock).mockResolvedValue(rows);
});

it("renders nothing when signed out", () => {
  const { toJSON } = render(<DraftReviews token={null} />);
  expect(toJSON()).toBeNull();
});

it("renders nothing when there is no feedback", async () => {
  (api.myDrafts as jest.Mock).mockResolvedValue([]);
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalled());
  expect(screen.queryByText(/Feedback on your drafts/i)).toBeNull();
});

it("lists a draft with its comment count", async () => {
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(screen.getByText("My Draft")).toBeTruthy());
  expect(screen.getByText("2 comments")).toBeTruthy();
});

it("tapping a row with a local book opens the Share modal", async () => {
  (store.loadBook as jest.Mock).mockResolvedValue({ id: "b1", title: "My Draft" });
  render(<DraftReviews token="tok" />);
  fireEvent.press(await screen.findByLabelText("Review feedback: My Draft"));
  await waitFor(() => expect(screen.getByText("MODAL:My Draft")).toBeTruthy());
});

it("tapping a row whose book isn't on the device alerts instead of opening", async () => {
  (store.loadBook as jest.Mock).mockResolvedValue(null);
  render(<DraftReviews token="tok" />);
  fireEvent.press(await screen.findByLabelText("Review feedback: My Draft"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(screen.queryByText(/^MODAL:/)).toBeNull();
});

it("refetches when the screen regains focus", async () => {
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalledTimes(1));
  await act(async () => {
    mockFocus.run?.();
  });
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalledTimes(2));
});
