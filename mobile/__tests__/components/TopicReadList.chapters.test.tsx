import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TopicReadList } from "@/components/TopicReadList";
import type { Book } from "@/types/book";

const importedBook = {
  id: "bk-1",
  title: "Frankenstein",
  toc: { subjects: [{ subject_label: "Novel", units: [{ id: "bk-1-ch1", title: "Letter 1" }] }] },
  chapters: {
    "bk-1-ch1": {
      chapterId: "bk-1-ch1",
      title: "Letter 1",
      html: "<p>hi</p>",
      images: {},
      importedAt: "2026-07-16T00:00:00.000Z",
    },
  },
} as unknown as Book;

it("shows an imported book's chapters as readable", () => {
  // Regression: flatten() read book.content only, so an imported book (which has
  // book.chapters and NO content) rendered an empty list — the book was invisible.
  const onOpen = jest.fn();
  render(<TopicReadList book={importedBook} onOpen={onOpen} />);
  fireEvent.press(screen.getByLabelText("Read chapter: Letter 1"));
  expect(onOpen).toHaveBeenCalledWith("bk-1-ch1", "chapter");
});
