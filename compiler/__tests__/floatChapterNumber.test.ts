import { floatChapterNumber } from "../src/pdf";

describe("floatChapterNumber", () => {
  it("uses the Anuvaka number for an Anuvaka topic", () => {
    expect(floatChapterNumber({ number: 9, title: "Anuvaka 4 — Agricultural Abundance and Crops" })).toBe(4);
    expect(floatChapterNumber({ number: 14, title: "Anuvaka 9 — Cosmic Rhythms, Vows and Invocations" })).toBe(9);
    expect(floatChapterNumber({ number: 6, title: "anuvaka 1 - Vital Energies" })).toBe(1);
  });

  it("falls back to the chapter position for other topics", () => {
    expect(floatChapterNumber({ number: 2, title: "Structure of the Chamakam" })).toBe(2);
    expect(floatChapterNumber({ number: 3, title: "Full Transliterated Text" })).toBe(3);
  });

  it("does not read a number out of a longer word", () => {
    expect(floatChapterNumber({ number: 7, title: "Anuvakas 1-4 overview" })).toBe(7);
  });

  it("handles a missing title", () => {
    expect(floatChapterNumber({ number: 5, title: undefined as unknown as string })).toBe(5);
  });
});
