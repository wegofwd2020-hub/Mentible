import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// `status: "signed_in"` is needed so `RequireSignIn` (which BooksScreen wraps
// itself in) renders the real screen instead of its sign-in interstitial — the
// brief's mock only covered `accessToken`, which isn't enough to reach the row.
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/storage/bookStore", () => ({
  loadBookIndex: jest.fn().mockResolvedValue([{ id: "b1", title: "My Draft", updatedAt: "" }]),
  loadBook: jest.fn().mockResolvedValue({ id: "b1", title: "My Draft" }),
  deleteBook: jest.fn(),
  hasRenderableLesson: jest.fn().mockReturnValue(true),
}));
jest.mock("@/api/client", () => ({
  myDrafts: jest.fn().mockResolvedValue([{ book_id: "b1", title: "My Draft", version: "1.0", comment_count: 2, last_comment_at: null }]),
}));
jest.mock("@/components/ShareDraftModal", () => ({
  ShareDraftModal: ({ visible, book }: { visible: boolean; book: { title: string } }) => {
    const { Text } = require("react-native");
    return visible ? <Text>MODAL:{book.title}</Text> : null;
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import BooksScreen from "@/../app/(tabs)/books";

it("shows a feedback badge on a book with comments and opens its Share modal", async () => {
  render(<BooksScreen />);
  const badge = await screen.findByLabelText("Feedback: 2 comments");
  fireEvent.press(badge);
  await waitFor(() => expect(screen.getByText("MODAL:My Draft")).toBeTruthy());
});
