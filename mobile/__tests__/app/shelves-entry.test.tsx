import { render, fireEvent, waitFor } from "@testing-library/react-native";

let mockCatalog: any;
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ sourceId: "s1", entryId: "e1" }) }));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => mockCatalog }));

// The platform seam: on web the browser owns the transfer, so the engine's
// byte-count contract can't be honoured (see downloadIO). Flip the flag per test.
let mockOfflineCapable = true;
const mockIO = { dir: "/dl/" };
const mockBrowserDownload = jest.fn();
jest.mock("@/openshelves/downloadIO", () => ({
  get supportsOfflineDownloads() { return mockOfflineCapable; },
  makeIO: () => mockIO,
  browserDownload: (url: string) => mockBrowserDownload(url),
}));

const mockDownloadEntry = jest.fn();
jest.mock("@/openshelves/downloadEngine", () => ({ downloadEntry: (...a: any[]) => mockDownloadEntry(...a) }));

import EntryDetailScreen from "@/../app/shelves/[sourceId]/[entryId]";

const EPUB = { href: "/a.epub", mimeType: "application/epub+zip", rel: "http://opds-spec.org/acquisition" };
const entry = (over: any = {}) => ({
  id: "e1", title: "Moby Dick", authors: ["Melville"], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "book", rightsText: null, mature: null, links: [EPUB], canonicalUrl: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOfflineCapable = true;
  mockDownloadEntry.mockResolvedValue({ entryId: "e1", bytes: 1234 });
  mockCatalog = {
    source: { id: "s1", title: "Lib", url: "https://ex.org/feed.atom", entryCount: 1, isStarter: false, addedAt: "T0", lastRefreshedAt: null },
    entries: [entry()],
    loading: false, busy: false, error: null, reload: jest.fn(), refresh: jest.fn(),
  };
});

test("native: downloads through the engine, resolving the link against the source feed URL", async () => {
  const { getByTestId, getByText } = render(<EntryDetailScreen />);
  fireEvent.press(getByTestId("download-entry"));

  await waitFor(() => expect(getByText(/saved on this device/i)).toBeTruthy());
  expect(mockDownloadEntry).toHaveBeenCalledWith(mockCatalog.entries[0], "s1", "https://ex.org/feed.atom", mockIO);
  expect(mockBrowserDownload).not.toHaveBeenCalled();
});

test("web: fire-and-forget to the browser — NEVER through the engine (it would throw 'empty')", async () => {
  mockOfflineCapable = false;
  const { getByTestId, getByText } = render(<EntryDetailScreen />);
  fireEvent.press(getByTestId("download-entry"));

  await waitFor(() => expect(getByText(/not stored in the app/i)).toBeTruthy());
  expect(mockBrowserDownload).toHaveBeenCalledWith("https://ex.org/a.epub"); // relative href resolved
  expect(mockDownloadEntry).not.toHaveBeenCalled();
});

test("a failed download surfaces the error and records nothing", async () => {
  mockDownloadEntry.mockRejectedValue(new Error("Download failed: HTTP 404."));
  const { getByTestId, getByText } = render(<EntryDetailScreen />);
  fireEvent.press(getByTestId("download-entry"));

  await waitFor(() => expect(getByText(/HTTP 404/)).toBeTruthy());
});

test("a video entry has no Download button (streaming-only, spec §2)", () => {
  mockCatalog = {
    ...mockCatalog,
    entries: [entry({ mediaType: "video", links: [{ href: "https://ex.org/v.mp4", mimeType: "video/mp4", rel: "x" }] })],
  };
  const { queryByTestId } = render(<EntryDetailScreen />);
  expect(queryByTestId("download-entry")).toBeNull();
});

test("an entry with no downloadable link has no Download button", () => {
  mockCatalog = { ...mockCatalog, entries: [entry({ links: [] })] };
  const { queryByTestId } = render(<EntryDetailScreen />);
  expect(queryByTestId("download-entry")).toBeNull();
});
