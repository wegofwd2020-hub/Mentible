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
import { publishBrowseFrame, clearBrowseFrame } from "@/openshelves/browseContext";

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
  clearBrowseFrame("s1");
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

// FIX 1 — a leaf entry reached only inside a drilled-in sub-feed is never in
// the stored catalog (cat.entries). The catalog screen publishes the current
// browse frame to the transient browseContext registry before pushing; this
// screen must resolve from that registry first, falling back to the stored
// catalog only when no browse context is present (see FIX 1 test 3 below).
test("a leaf entry that exists ONLY in a drilled-in sub-feed opens on the detail screen", () => {
  const subOnlyEntry = entry({ title: "Sub-feed Only Book" });
  publishBrowseFrame("s1", "https://ex.org/ebooks/2701/opds/", [subOnlyEntry]);
  mockCatalog = { ...mockCatalog, entries: [] }; // NOT in the stored root catalog

  const { getByText, getByTestId } = render(<EntryDetailScreen />);
  expect(getByText("Sub-feed Only Book")).toBeTruthy();
  expect(getByTestId("download-entry")).toBeTruthy();
});

test("its download target resolves against the SUB-FEED's URL, not the root's", async () => {
  const subUrl = "https://ex.org/ebooks/2701/opds/";
  const rootUrl = "https://ex.org/feed.atom"; // deliberately a different base than subUrl
  const relLink = { href: "download.epub", mimeType: "application/epub+zip", rel: "http://opds-spec.org/acquisition" };
  const subOnlyEntry = entry({ links: [relLink] });
  publishBrowseFrame("s1", subUrl, [subOnlyEntry]);
  mockCatalog = { ...mockCatalog, source: { ...mockCatalog.source, url: rootUrl }, entries: [] };

  const { getByTestId, getByText } = render(<EntryDetailScreen />);
  fireEvent.press(getByTestId("download-entry"));

  await waitFor(() => expect(getByText(/saved on this device/i)).toBeTruthy());
  // baseFeedUrl passed to the engine must be the sub-feed's URL (a relative
  // href means something different resolved against the root feed).
  expect(mockDownloadEntry).toHaveBeenCalledWith(subOnlyEntry, "s1", subUrl, mockIO);
});

test("regression: a root/stored entry still opens with no browse context set (fallback path)", () => {
  clearBrowseFrame("s1"); // simulate an app restart / deep link — no browse context published
  const { getByText, getByTestId } = render(<EntryDetailScreen />);
  expect(getByText("Moby Dick")).toBeTruthy();
  expect(getByTestId("download-entry")).toBeTruthy();
});
