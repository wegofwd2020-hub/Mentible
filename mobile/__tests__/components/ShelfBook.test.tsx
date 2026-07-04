import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBook, spineStyleFor } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";

const meta: EpubMeta = { id: "book-quantum", title: "Quantum Mechanics", sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };

it("spineStyleFor is deterministic for a given id", () => {
  expect(spineStyleFor("book-quantum")).toEqual(spineStyleFor("book-quantum"));
  expect(spineStyleFor("a").backgroundColor).toBeDefined();
  expect(spineStyleFor("a").height).toBeGreaterThanOrEqual(96);
});

it("renders the spine and fires onPress when tapped", () => {
  const onPress = jest.fn();
  render(<ShelfBook meta={meta} onPress={onPress} />);
  fireEvent.press(screen.getByLabelText("Open: Quantum Mechanics"));
  expect(onPress).toHaveBeenCalledTimes(1);
});
