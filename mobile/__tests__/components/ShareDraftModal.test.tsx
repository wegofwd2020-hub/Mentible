import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import type { Book } from "@/types/book";

jest.mock("@/api/client", () => ({
  shareDraft: jest.fn().mockResolvedValue(undefined),
  listInvitations: jest.fn().mockResolvedValue([]),
  addInvitation: jest.fn().mockResolvedValue(undefined),
  revokeInvitation: jest.fn().mockResolvedValue(undefined),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn().mockResolvedValue({ id: 1, version: "1.0", body: "x", author_response: null }),
  setCommentResponse: jest.fn().mockResolvedValue({}),
}));
import * as api from "@/api/client";

const book = { id: "b1", title: "T", toc: { subjects: [] }, createdAt: "", updatedAt: "", metadata: { version: "1.0" } } as unknown as Book;

it("shares the draft on open and adds an invitation", async () => {
  render(<ShareDraftModal visible book={book} token="tok" onClose={jest.fn()} />);
  await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Invite by email"), "alice@x.com");
  fireEvent.press(screen.getByLabelText("Send invite"));
  await waitFor(() => expect(api.addInvitation).toHaveBeenCalledWith("b1", "alice@x.com", "tok"));
});
