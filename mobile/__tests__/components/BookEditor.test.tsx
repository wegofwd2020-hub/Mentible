import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { BookEditor } from "../../src/components/BookEditor";
import type { Book, GeneratedTopic, StructuredTOC } from "../../src/types/book";

const mockSaveBook = jest.fn().mockResolvedValue(undefined);
const mockLoadBook = jest.fn();

jest.mock("../../src/storage/bookStore", () => ({
  saveBook: (...args: unknown[]) => mockSaveBook(...args),
  loadBook: (...args: unknown[]) => mockLoadBook(...args),
}));

const TOC: StructuredTOC = {
  subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }],
};

const GEN: GeneratedTopic = {
  topicId: "u1",
  title: "T",
  lesson: { topic: "T" } as unknown as GeneratedTopic["lesson"],
  generatedAt: "2026-05-27T00:00:00.000Z",
};

beforeEach(() => {
  mockSaveBook.mockClear();
  mockLoadBook.mockReset();
});

it("preserves generated content when an existing book is saved (regression)", async () => {
  const existing: Book = {
    id: "b1",
    title: "Old title",
    toc: TOC,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    content: { u1: GEN },
  };
  mockLoadBook.mockResolvedValue(existing);

  render(
    <BookEditor bookId="b1" initialTitle="Old title" initialToc={TOC} createdAt={existing.createdAt} onSaved={() => {}} />,
  );
  fireEvent.press(screen.getByLabelText("Save book"));

  await waitFor(() => expect(mockSaveBook).toHaveBeenCalledTimes(1));
  const saved = mockSaveBook.mock.calls[0][0] as Book;
  expect(saved.content).toEqual({ u1: GEN }); // content carried through, not dropped
});

it("creates a new book with no content (bookId null → no loadBook)", async () => {
  render(<BookEditor bookId={null} initialTitle="Fresh" initialToc={TOC} onSaved={() => {}} />);
  fireEvent.press(screen.getByLabelText("Save book"));

  await waitFor(() => expect(mockSaveBook).toHaveBeenCalledTimes(1));
  expect(mockLoadBook).not.toHaveBeenCalled();
  const saved = mockSaveBook.mock.calls[0][0] as Book;
  expect(saved.content).toBeUndefined();
});
