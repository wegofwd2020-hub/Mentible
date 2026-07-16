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

it("surfaces an error when posting a comment fails", async () => {
  (api.postComment as jest.Mock).mockRejectedValueOnce(new Error("network blip"));
  render(<ShareDraftModal visible book={book} token="tok" onClose={jest.fn()} />);
  await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "great chapter");
  fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(api.postComment).toHaveBeenCalledWith("b1", "1.0", "great chapter", "tok"));
  expect(await screen.findByText("network blip")).toBeTruthy();
});

// #320: the author's false assumption is upstream of the reviewer's confusion —
// warn BEFORE anyone is invited. Figures do travel in the compiled EPUB/PDF
// (slice 1's compilePayload), which is the honest alternative to point at;
// draft sharing carrying figures is fenced by ADR-035 D4.
describe("figures notice (#320)", () => {
  const img = (id: string) => ({ id, file: `media/b1/${id}.jpg`, mime: "image/jpeg", addedAt: "x" });
  const bookWithFigures = (n: number) =>
    ({
      ...book,
      content: {
        t1: { topicId: "t1", title: "U", lesson: {}, generatedAt: "x", images: Array.from({ length: n }, (_, i) => img(`i${i}`)) },
      },
    }) as unknown as Book;

  it("warns the author their figures won't be shared, and names the alternative", async () => {
    render(<ShareDraftModal visible book={bookWithFigures(3)} token="tok" onClose={jest.fn()} />);
    await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
    expect(screen.getByText(/3 figures won't be shared/i)).toBeTruthy();
    expect(screen.getByText(/export the book as EPUB or PDF/i)).toBeTruthy();
  });

  it("uses the singular for one figure", async () => {
    render(<ShareDraftModal visible book={bookWithFigures(1)} token="tok" onClose={jest.fn()} />);
    await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
    expect(screen.getByText(/1 figure won't be shared/i)).toBeTruthy();
  });

  it("says nothing for a book with no figures", async () => {
    render(<ShareDraftModal visible book={book} token="tok" onClose={jest.fn()} />);
    await waitFor(() => expect(api.shareDraft).toHaveBeenCalled());
    expect(screen.queryByText(/won't be shared/i)).toBeNull();
  });
});
