import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBook, spineStyleFor } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";

const meta: EpubMeta = { id: "book-quantum", title: "Quantum Mechanics", sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };

const noop = () => {};
function renderBook(overrides: Partial<React.ComponentProps<typeof ShelfBook>> = {}) {
  return render(
    <ShelfBook
      meta={meta}
      expanded={false}
      onPressSpine={noop}
      onRead={noop}
      onReviews={noop}
      onMove={noop}
      onDetails={noop}
      onDelete={noop}
      {...overrides}
    />,
  );
}

it("spineStyleFor is deterministic for a given id", () => {
  expect(spineStyleFor("book-quantum")).toEqual(spineStyleFor("book-quantum"));
  expect(spineStyleFor("a").backgroundColor).toBeDefined();
  expect(spineStyleFor("a").height).toBeGreaterThanOrEqual(96);
});

it("collapsed: tapping the spine calls onPressSpine", () => {
  const onPressSpine = jest.fn();
  renderBook({ onPressSpine });
  fireEvent.press(screen.getByLabelText("Open: Quantum Mechanics"));
  expect(onPressSpine).toHaveBeenCalled();
});

it("expanded: shows the action row and fires the right handlers", () => {
  const onRead = jest.fn();
  const onMove = jest.fn();
  const onDelete = jest.fn();
  renderBook({ expanded: true, onRead, onMove, onDelete, reviewCount: 3 });
  fireEvent.press(screen.getByLabelText("Read: Quantum Mechanics"));
  fireEvent.press(screen.getByLabelText("Move to shelf: Quantum Mechanics"));
  fireEvent.press(screen.getByLabelText("Delete from library: Quantum Mechanics"));
  expect(onRead).toHaveBeenCalled();
  expect(onMove).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});
