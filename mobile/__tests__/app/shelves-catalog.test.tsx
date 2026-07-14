import { render, fireEvent } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockPush = jest.fn();
let mockCatalog: any;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sourceId: "s1" }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => mockCatalog }));
jest.mock("@/openshelves/fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("@/openshelves/opds12", () => ({ parseOpds12: jest.fn() }));
// This file predates the Task 7 filter bar and isn't testing filtering/prefs
// (see shelves-catalog-filter.test.tsx for that) — stub useShelfPrefs as
// already-loaded with neutral prefs so these tests stay deterministic and
// don't trip a real-hook act() warning from its async load settling after
// a synchronous assertion.
jest.mock("@/openshelves/useShelfPrefs", () => ({
  useShelfPrefs: () => ({ prefs: { language: "all", hideMature: true }, setPrefs: jest.fn(), loading: false }),
}));
import CatalogScreen from "@/../app/shelves/[sourceId]";

const entry = (id: string) => ({ id, title: id, authors: ["A"], summary: "", coverUrl: null, language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockCatalog = { source: { id: "s1", title: "Lib", url: "https://ex.org/f", entryCount: 2, isStarter: false, addedAt: "T0", lastRefreshedAt: null }, entries: [entry("a"), entry("b")], loading: false, busy: false, error: null, reload: jest.fn(), refresh: jest.fn() };
});

test("lists entries and navigates on tap", () => {
  const { getByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("entry-a"));
  expect(mockPush).toHaveBeenCalledWith("/shelves/s1/a");
});

test("shows the source title and empty state when no entries", () => {
  mockCatalog = { ...mockCatalog, entries: [] };
  const { getByText } = render(<CatalogScreen />);
  expect(getByText("Lib")).toBeTruthy();
  expect(getByText(/no items/i)).toBeTruthy();
});

test("tapping a navigation entry drills in; Back returns to the root", async () => {
  const nav = entry("nav"); (nav as any).navigationUrl = "/sub.opds";
  mockCatalog = { ...mockCatalog, source: { ...mockCatalog.source, url: "https://ex.org/c.opds" }, entries: [nav] };
  const fetchFeed = require("@/openshelves/fetchFeed").fetchFeed as jest.Mock;
  const parseOpds12 = require("@/openshelves/opds12").parseOpds12 as jest.Mock;
  fetchFeed.mockResolvedValue("<feed/>");
  parseOpds12.mockReturnValue({ feedTitle: "Sub", entries: [entry("child")] });

  const { getByTestId, findByTestId, queryByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("entry-nav"));           // drill in
  expect(await findByTestId("entry-child")).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();             // navigation ≠ open detail
  fireEvent.press(getByTestId("browse-back"));         // back to root
  expect(queryByTestId("entry-nav")).toBeTruthy();
});

test("invariant pin: drilling into a sub-feed never persists its entries", async () => {
  // Sub-feed entries are transient (spec N2) — only the top-level source
  // catalog is ever written to AsyncStorage. This is a BEHAVIORAL pin, not
  // just a structural one: it spies on the real (jest-mocked) AsyncStorage
  // and asserts drilling in never calls setItem with the sub-feed's entries,
  // guarding against a future change (e.g. a browse-context handoff) that
  // accidentally routes through persistence.
  const nav = entry("nav"); (nav as any).navigationUrl = "/sub.opds";
  mockCatalog = { ...mockCatalog, source: { ...mockCatalog.source, url: "https://ex.org/c.opds" }, entries: [nav] };
  const fetchFeed = require("@/openshelves/fetchFeed").fetchFeed as jest.Mock;
  const parseOpds12 = require("@/openshelves/opds12").parseOpds12 as jest.Mock;
  fetchFeed.mockResolvedValue("<feed/>");
  parseOpds12.mockReturnValue({ feedTitle: "Sub", entries: [entry("child")] });

  const setItemSpy = jest.spyOn(AsyncStorage, "setItem");
  const { getByTestId, findByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("entry-nav")); // drill in
  expect(await findByTestId("entry-child")).toBeTruthy();

  expect(setItemSpy).not.toHaveBeenCalled();
  setItemSpy.mockRestore();
});

test("renders the catalog-refresh control and calls useSourceCatalog's refresh on press", () => {
  const { getByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("catalog-refresh"));
  expect(mockCatalog.refresh).toHaveBeenCalledTimes(1);
});

test("a top-level source-catalog error (cat.error) renders on screen", () => {
  mockCatalog = { ...mockCatalog, error: "Could not load this source." };
  const { getByText } = render(<CatalogScreen />);
  expect(getByText("Could not load this source.")).toBeTruthy();
});
