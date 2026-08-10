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

const mockExport = exportBook as jest.Mock;
const mockDownload = downloadArtifact as jest.Mock;

const book = {
  id: "b1",
  title: "Physics",
  toc: { subjects: [] },
  createdAt: "",
  updatedAt: "",
} as Book;

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

  // The Button primitive is medium weight (500), never bold (700) — assert
  // the swept labels don't carry the old raw fontWeight.
  expect(screen.getByText("EPUB3").props.style.fontWeight).not.toBe("700");
  expect(screen.getByText("PDF").props.style.fontWeight).not.toBe("700");
});
