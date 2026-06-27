import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { BookMetadataModal, deriveRows } from "../../src/components/BookMetadataModal";
import type { Book, GeneratedTopic, StructuredTOC } from "../../src/types/book";
import type { GenerationParams } from "../../src/types/generationParams";

const TOC: StructuredTOC = {
  subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }],
};

const PARAMS: GenerationParams = {
  level: "student",
  depth: "deep",
  pages: 120,
  language: "en",
  format: "lesson",
  diagramRegister: "technical",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
};

const TOPIC: GeneratedTopic = {
  topicId: "u1",
  title: "T",
  lesson: { topic: "T" } as unknown as GeneratedTopic["lesson"],
  generatedAt: "2026-06-01T00:00:00.000Z",
  // A verified, different model than the template → should win over generationParams.
  provenance: { provider: "anthropic", model: "claude-opus-4-8", model_verified: true },
};

const FULL_BOOK: Book = {
  id: "b1",
  title: "Product Sense and AI",
  toc: TOC,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  generationParams: PARAMS,
  content: { u1: TOPIC },
  metadata: { releaseDate: "2026-06-01", reviewedBy: "Sridhar P.", reviewedOn: "2026-06-10" },
};

describe("deriveRows", () => {
  it("pulls every field from a fully populated book", () => {
    const rows = deriveRows(FULL_BOOK, { title: "ignored" });
    expect(rows.name).toBe("Product Sense and AI");
    expect(rows.model).toBe("claude-opus-4-8 ✓"); // provenance wins, verified marker
    expect(rows.level).toBe("Student");
    expect(rows.depth).toBe("Deep");
    expect(rows.diagrams).toBe("Technical");
    expect(rows.pages).toBe("120");
    expect(rows.reviewedBy).toBe("Sridhar P.");
    expect(rows.released).toMatch(/2026/);
    expect(rows.reviewedOn).toMatch(/2026/);
  });

  it("falls back to placeholders when there is no in-app book (imported EPUB)", () => {
    const rows = deriveRows(null, { title: "Imported.epub", compiledAt: "2026-05-01T00:00:00.000Z" });
    expect(rows.name).toBe("Imported.epub");
    expect(rows.released).toMatch(/2026/); // from the EPUB compile date
    expect(rows.model).toBe("—");
    expect(rows.level).toBe("—");
    expect(rows.depth).toBe("—");
    expect(rows.diagrams).toBe("—");
    expect(rows.pages).toBe("—");
    expect(rows.reviewedBy).toBe("Not reviewed");
    expect(rows.reviewedOn).toBe("—");
  });

  it("renders a 0 page target as 'No limit'", () => {
    const book = { ...FULL_BOOK, generationParams: { ...PARAMS, pages: 0 } };
    expect(deriveRows(book, { title: "x" }).pages).toBe("No limit");
  });

  it("shows the provider's default model when no model is pinned and no provenance exists", () => {
    const book: Book = {
      ...FULL_BOOK,
      content: {},
      generationParams: { ...PARAMS, model: null },
    };
    expect(deriveRows(book, { title: "x" }).model).toBe("anthropic (default model)");
  });
});

describe("BookMetadataModal", () => {
  const fallback = { title: "Product Sense and AI", compiledAt: "2026-06-01T00:00:00.000Z" };

  it("shows the fields and fires Read / Close", () => {
    const onRead = jest.fn();
    const onClose = jest.fn();
    render(
      <BookMetadataModal visible book={FULL_BOOK} meta={fallback} onRead={onRead} onClose={onClose} />,
    );

    expect(screen.getByText("Model Used")).toBeTruthy();
    expect(screen.getByText("claude-opus-4-8 ✓")).toBeTruthy();
    expect(screen.getByText("Sridhar P.")).toBeTruthy();
    expect(screen.getByText("Pages (target)")).toBeTruthy();

    fireEvent.press(screen.getByText("Read"));
    expect(onRead).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the field rows while the book is loading", () => {
    render(
      <BookMetadataModal
        visible
        book={null}
        meta={fallback}
        loading
        onRead={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByText("Model Used")).toBeNull();
    // The title still shows from the fallback meta.
    expect(screen.getByText("Product Sense and AI")).toBeTruthy();
  });
});
