import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBand } from "@/components/ShelfBand";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

const shelf: Shelf = { id: "s1", name: "Physics", createdAt: "2026-07-04T00:00:00Z", order: 0 };
const book = (id: string): EpubMeta => ({ id, title: id, sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" });

const handlers = {
  onExpand: jest.fn(),
  onRead: jest.fn(),
  onReviews: jest.fn(),
  onMove: jest.fn(),
  onDetails: jest.fn(),
  onDelete: jest.fn(),
  onRename: jest.fn(),
  onDeleteShelf: jest.fn(),
};

function renderBand(overrides: Partial<React.ComponentProps<typeof ShelfBand>> = {}) {
  return render(
    <ShelfBand
      shelf={shelf}
      books={[book("b1")]}
      expandedId={null}
      counts={{}}
      exportStatus={{}}
      published={{}}
      {...handlers}
      {...overrides}
    />,
  );
}

beforeEach(() => Object.values(handlers).forEach((h) => h.mockClear()));

it("renders the shelf name and its books", () => {
  renderBand();
  expect(screen.getByText("Physics")).toBeTruthy();
  expect(screen.getByLabelText("Open: b1")).toBeTruthy();
});

it("shows an empty-shelf hint when the shelf has no books", () => {
  renderBand({ books: [] });
  expect(screen.getByText(/No books yet/i)).toBeTruthy();
});

it("rename and delete controls fire for a real shelf", () => {
  renderBand();
  fireEvent.press(screen.getByLabelText("Rename shelf: Physics"));
  fireEvent.press(screen.getByLabelText("Delete shelf: Physics"));
  expect(handlers.onRename).toHaveBeenCalled();
  expect(handlers.onDeleteShelf).toHaveBeenCalled();
});

it("the Unshelved band has no rename/delete controls", () => {
  renderBand({ shelf: null });
  expect(screen.getByText("Unshelved")).toBeTruthy();
  expect(screen.queryByLabelText(/Rename shelf/)).toBeNull();
  expect(screen.queryByLabelText(/Delete shelf/)).toBeNull();
});
