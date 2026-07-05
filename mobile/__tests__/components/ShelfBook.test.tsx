import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShelfBook, spineStyleFor } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";

const meta: EpubMeta = { id: "book-quantum", title: "Quantum Mechanics", sizeBytes: 100 * 1024, compiledAt: "2026-07-04T00:00:00Z" };

it("spineStyleFor: colour is deterministic from id (independent of size)", () => {
  expect(spineStyleFor("book-quantum", 100_000)).toEqual(spineStyleFor("book-quantum", 100_000));
  // Same id → same colour regardless of file size (only height depends on size).
  expect(spineStyleFor("a", 1_000).backgroundColor).toBe(spineStyleFor("a", 9_000_000).backgroundColor);
});

it("spineStyleFor: bigger file → taller spine, clamped to 96–128", () => {
  const tiny = spineStyleFor("x", 1).height; // below MIN → shortest
  const small = spineStyleFor("x", 100 * 1024).height; // 100 KB
  const big = spineStyleFor("x", 3 * 1024 * 1024).height; // 3 MB
  const huge = spineStyleFor("x", 50 * 1024 * 1024).height; // above MAX → tallest

  expect(tiny).toBe(96);
  expect(huge).toBe(128);
  expect(small).toBeGreaterThan(tiny);
  expect(big).toBeGreaterThan(small);

  for (const h of [tiny, small, big, huge]) {
    expect(h).toBeGreaterThanOrEqual(96);
    expect(h).toBeLessThanOrEqual(128);
  }
});

it("renders the spine and fires onPress when tapped", () => {
  const onPress = jest.fn();
  render(<ShelfBook meta={meta} onPress={onPress} />);
  fireEvent.press(screen.getByLabelText("Open: Quantum Mechanics"));
  expect(onPress).toHaveBeenCalledTimes(1);
});
