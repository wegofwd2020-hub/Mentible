import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { CheckoutButton } from "@/components/CheckoutButton";
import { exportBook } from "@/api/client";
import { downloadArtifact } from "@/storage/epubLibrary";
import type { Book } from "@/types/book";
import type { TrustManifest } from "@/types/trust";

jest.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  exportBook: jest.fn(),
}));
jest.mock("@/storage/epubLibrary", () => ({ downloadArtifact: jest.fn() }));
jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async () => new Map()),
  resolveAudioDataUrls: jest.fn(async (t: any) =>
    new Map((t.audio ?? []).map((a: any) => [a.id, `data:${a.mime};base64,AA`])),
  ),
}));

const mockExport = exportBook as jest.Mock;
const mockDownload = downloadArtifact as jest.Mock;

const book = {
  id: "b1",
  title: "Physics",
  toc: { subjects: [] },
  createdAt: "",
  updatedAt: "",
} as Book;

// A book whose one topic carries a narration clip — used by the KDP/pack
// audio-inclusion tests below. Kept separate from `book` so the other tests
// (which assert on exportBook's call shape without caring about content)
// stay unchanged.
const bookWithAudio = {
  ...book,
  content: {
    t1: {
      topicId: "t1",
      title: "U",
      generatedAt: "x",
      lesson: {
        topic: "U", synopsis: "s", learning_objectives: [],
        sections: [{ heading: "H", body_markdown: "b" }],
        key_takeaways: [],
      },
      audio: [{ id: "a1", file: "media/b1/a1.mp3", mime: "audio/mpeg", title: "Intro" }],
    },
  },
} as unknown as Book;

// Like bookWithAudio, but the clip carries a transcript — used by the epub2
// transcript-fallback test below. bookWithAudio has no transcript, which the
// epub2 path correctly treats as "nothing to show" (see the no-transcript
// test below), so this needs its own fixture.
const bookWithAudioTranscript = {
  ...book,
  content: {
    t1: {
      topicId: "t1",
      title: "U",
      generatedAt: "x",
      lesson: {
        topic: "U", synopsis: "s", learning_objectives: [],
        sections: [{ heading: "H", body_markdown: "b" }],
        key_takeaways: [],
      },
      audio: [{ id: "a1", file: "media/b1/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hello there." }],
    },
  },
} as unknown as Book;

const manifest: TrustManifest = {
  trust_manifest_version: 1,
  provenance: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    model_verified: true,
    integration_version: 1,
    contract_version: 1,
  },
  validation: { schema_validated: true },
  compliance: {
    ruleset: "mentible-professional@1.0",
    checks_passed: 5,
    checks_total: 5,
    status: "pass",
  },
  integrity: { content_hash: "sha256:abc" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDownload.mockResolvedValue({ savedPath: "/Downloads/physics.epub" });
});

it("renders the book-level TrustBadge after a successful checkout", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: manifest });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Check out as EPUB3" }));

  // The badge headline (from the manifest's all-pass status) appears on success.
  expect(await screen.findByText("Quality-checked")).toBeTruthy();
  // Expanding shows the export-time compliance row.
  fireEvent.press(screen.getByText("Quality-checked"));
  expect(await screen.findByText(/Passed 5\/5 format checks/)).toBeTruthy();
});

it("shows the success message but no badge when no manifest is returned", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Check out as EPUB3" }));

  await waitFor(() => expect(screen.getByText(/Saved:/)).toBeTruthy());
  expect(screen.queryByText("Quality-checked")).toBeNull();
});

it("renders the checkout actions via the Button primitive with no bold label weight", () => {
  render(<CheckoutButton book={book} />);

  // Both formats are exposed as accessible buttons (the Button primitive),
  // not bare Pressables — this is the P1 re-skin contract for this control.
  expect(screen.getByRole("button", { name: "Check out as EPUB3" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check out as PDF" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export a KDP-clean EPUB for Kindle" })).toBeTruthy();

  // The Button primitive is medium weight (500), never bold (700) — assert
  // the swept labels don't carry the old raw fontWeight.
  expect(screen.getByText("EPUB3").props.style.fontWeight).not.toBe("700");
  expect(screen.getByText("PDF").props.style.fontWeight).not.toBe("700");
});

it("Kindle (KDP) checks out a distinct, profile=kdp EPUB", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Export a KDP-clean EPUB for Kindle" }));

  await waitFor(() => expect(screen.getByText(/KDP-clean EPUB downloaded|Saved:/)).toBeTruthy());
  expect(mockExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ format: "epub", diagrams: true, profile: "kdp" }),
  );
  expect(mockDownload).toHaveBeenCalledWith(
    expect.anything(),
    "physics-kdp.epub",
    "application/epub+zip",
  );
});

it("renders the Publish pack button", () => {
  render(<CheckoutButton book={book} />);
  expect(
    screen.getByRole("button", { name: "Download a publish pack for retailers" }),
  ).toBeTruthy();
});

it("Publish pack requests format=pack with diagrams:true (so book.epub rasterizes Mermaid, not placeholders) and downloads a .zip", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Download a publish pack for retailers" }));

  await waitFor(() => expect(screen.getByText(/Publish pack downloaded|Saved:/)).toBeTruthy());
  expect(mockExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ format: "pack", diagrams: true }),
  );
  expect(mockDownload).toHaveBeenCalledWith(
    expect.anything(),
    "physics-publish-pack.zip",
    "application/zip",
  );
});

it("Publish pack button re-enables after a failed export", async () => {
  mockExport.mockRejectedValue(new Error("network fetch failed"));
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Download a publish pack for retailers" }));

  await waitFor(() => expect(screen.getByText(/Couldn’t reach the server/)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Download a publish pack for retailers" });
  expect(button.props.accessibilityState?.disabled).toBe(false);
});

// Fix 2 (compilePayload audio format-gate): KDP and Publish Pack are both
// EPUB-based exports, so — unlike a plain PDF checkout — they must still
// carry narration audio through to the compiler.
it("Kindle (KDP) posts a payload that includes the book's narration audio", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudio} />);

  fireEvent.press(screen.getByRole("button", { name: "Export a KDP-clean EPUB for Kindle" }));

  await waitFor(() => expect(screen.getByText(/KDP-clean EPUB downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const secs = postedBook.content!.t1.lesson.sections;
  expect(secs.at(-1)!.heading).toBe("Narration");
  expect(secs.at(-1)!.body_markdown).toContain("<audio");
});

it("plain PDF checkout posts a payload with NO narration audio", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudio} />);

  fireEvent.press(screen.getByRole("button", { name: "Check out as PDF" }));

  await waitFor(() => expect(screen.getByText(/Saved:|PDF downloaded/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const headings = postedBook.content!.t1.lesson.sections.map((s) => s.heading);
  expect(headings).not.toContain("Narration");
});

it("Publish pack posts a payload that includes the book's narration audio", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudio} />);

  fireEvent.press(screen.getByRole("button", { name: "Download a publish pack for retailers" }));

  await waitFor(() => expect(screen.getByText(/Publish pack downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const secs = postedBook.content!.t1.lesson.sections;
  expect(secs.at(-1)!.heading).toBe("Narration");
  expect(secs.at(-1)!.body_markdown).toContain("<audio");
});

it("renders the EPUB 2 (max compatibility) button", () => {
  render(<CheckoutButton book={book} />);
  expect(
    screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }),
  ).toBeTruthy();
});

it("EPUB 2 (max compatibility) checks out a distinct, profile=epub2 EPUB", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  expect(mockExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ format: "epub", diagrams: true, profile: "epub2" }),
  );
  expect(mockDownload).toHaveBeenCalledWith(
    expect.anything(),
    "physics-epub2.epub",
    "application/epub+zip",
  );
});

it("EPUB 2 (max compatibility) button re-enables after a failed export", async () => {
  mockExport.mockRejectedValue(new Error("network fetch failed"));
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/Couldn’t reach the server/)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" });
  expect(button.props.accessibilityState?.disabled).toBe(false);
});

it("EPUB 2 (max compatibility) posts a payload with the narration TRANSCRIPT, not <audio>", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudioTranscript} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const secs = postedBook.content!.t1.lesson.sections;
  expect(secs.at(-1)!.heading).toBe("Narration (transcript)");
  expect(secs.at(-1)!.body_markdown).toContain("Hello there.");
  expect(secs.at(-1)!.body_markdown).not.toContain("<audio");
});

it("EPUB 2 (max compatibility) with a clip that has no transcript gets no Narration section", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudio} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const headings = postedBook.content!.t1.lesson.sections.map((s) => s.heading);
  expect(headings).not.toContain("Narration (transcript)");
});
