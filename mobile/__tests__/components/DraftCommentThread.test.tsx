import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { DraftComment } from "@/api/client";

const c = (over: Partial<DraftComment> = {}): DraftComment => ({
  id: 1, version: "1.0", author_sub: "s", author_email: "a@x.com", body: "fix ch2",
  author_response: null, responded_at: null, created_at: "2026-07-05T00:00:00Z", ...over,
});

it("posts a new comment", () => {
  const onPost = jest.fn();
  render(<DraftCommentThread comments={[]} isOwner={false} onPost={onPost} />);
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "looks good");
  fireEvent.press(screen.getByLabelText("Send comment"));
  expect(onPost).toHaveBeenCalledWith("looks good");
});

it("renders an author response beneath a comment", () => {
  render(<DraftCommentThread comments={[c({ author_response: "fixed in v1.1" })]} isOwner={false} onPost={jest.fn()} />);
  expect(screen.getByText("fix ch2")).toBeTruthy();
  expect(screen.getByText(/fixed in v1.1/)).toBeTruthy();
  expect(screen.queryByLabelText(/response to comment/i)).toBeNull(); // no owner affordance
});

it("owner sees a response affordance and fires onRespond", () => {
  const onRespond = jest.fn();
  render(<DraftCommentThread comments={[c()]} isOwner onPost={jest.fn()} onRespond={onRespond} />);
  fireEvent.changeText(screen.getByLabelText("Response to comment 1"), "done");
  fireEvent.press(screen.getByLabelText("Save response to comment 1"));
  expect(onRespond).toHaveBeenCalledWith(1, "done");
});
