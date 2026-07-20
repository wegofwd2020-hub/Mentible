import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}) }));
const mockPush = jest.fn();
jest.mock("@/openshelves/importEpub", () => ({ importEpub: jest.fn(async () => ({ id: "bk-1", title: "Frankenstein" })) }));
// NOTE (deviation from the brief): the brief's mock used `downloads`/`mediaType`/`error`.
// The real useDownloads() (src/openshelves/useDownloads.ts) returns
// { items, total, loading, reload, remove, removeAll } — no `downloads`, no `error`.
// The real DownloadRecord (downloadsStore.ts) field is `mimeType`, not `mediaType`.
// downloads.tsx (unchanged by this plan) reads `dl.items`, so the mock must supply
// `items` or the screen renders an empty list and the test's queries never find the row.
jest.mock("@/openshelves/useDownloads", () => ({
  useDownloads: () => ({
    items: [{ entryId: "e1", title: "Frankenstein", bytes: 100, path: "file:///f.epub", mimeType: "application/epub+zip", sourceId: "s1", downloadedAt: "T0" }],
    total: 100,
    loading: false, remove: jest.fn(), removeAll: jest.fn(), reload: jest.fn(),
  }),
}));
jest.mock("expo-file-system", () => ({ readAsStringAsync: jest.fn(async () => "AAAA"), EncodingType: { Base64: "base64" } }));

import { importEpub } from "@/openshelves/importEpub";
import DownloadsScreen from "@/../app/shelves/downloads";

beforeEach(() => jest.clearAllMocks());

it("Open imports the downloaded EPUB and navigates to the book", async () => {
  render(<DownloadsScreen />);
  fireEvent.press(screen.getByLabelText("Open Frankenstein"));
  await waitFor(() => expect(importEpub).toHaveBeenCalled());
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("bk-1")));
});

it("surfaces an import failure instead of failing silently", async () => {
  (importEpub as jest.Mock).mockRejectedValueOnce(new Error("This book is copy-protected (DRM), so it can't be opened here."));
  render(<DownloadsScreen />);
  fireEvent.press(screen.getByLabelText("Open Frankenstein"));
  expect(await screen.findByText(/copy-protected/i)).toBeTruthy();
});
