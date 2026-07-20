// Task 7: ShelfFilterBar wiring on the catalog screen, plus the mount-race guard
// (not in the brief — see task-7 instructions). useShelfPrefs starts with
// `prefs = defaultPrefs()` and `loading = true` before the persisted value
// resolves; if the bar rendered during that window, a press would build
// `{ ...prefs, language: c }` on the still-default prefs and clobber a real
// stored value. So the bar must stay absent until `loading` is false.
import { render, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
let mockCatalog: any;
let mockShelfPrefs: any;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sourceId: "s1" }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => mockCatalog }));
jest.mock("@/openshelves/fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("@/openshelves/opds12", () => ({ parseOpds12: jest.fn() }));
jest.mock("@/openshelves/useShelfPrefs", () => ({ useShelfPrefs: () => mockShelfPrefs }));
import CatalogScreen from "@/../app/shelves/[sourceId]";

const entry = (id: string, language: string | null = null, mature: boolean | null = null) => ({
  id, title: id, authors: ["A"], summary: "", coverUrl: null, language, categories: [],
  mediaType: "book", rightsText: null, mature, links: [], canonicalUrl: null, navigationUrl: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCatalog = {
    source: { id: "s1", title: "Lib", url: "https://ex.org/f", entryCount: 2, isStarter: false, addedAt: "T0", lastRefreshedAt: null },
    entries: [entry("a", "en"), entry("b", "fr-FR")],
    loading: false,
    busy: false,
    error: null,
    reload: jest.fn(),
    refresh: jest.fn(),
  };
});

test("while useShelfPrefs is loading, the filter bar is absent (no clobber of a not-yet-loaded pref)", () => {
  mockShelfPrefs = { prefs: { language: "en", hideMature: true }, setPrefs: jest.fn(), loading: true };
  const { queryByTestId, getByTestId } = render(<CatalogScreen />);
  expect(queryByTestId("lang-all")).toBeNull();
  expect(queryByTestId("toggle-mature")).toBeNull();
  // The list itself still renders (filtering with the in-flight prefs is fine —
  // only a *write* built on a stale base would be dangerous).
  expect(getByTestId("entry-a")).toBeTruthy();
});

test("once useShelfPrefs resolves, the filter bar renders", () => {
  mockShelfPrefs = { prefs: { language: "all", hideMature: true }, setPrefs: jest.fn(), loading: false };
  const { getByTestId } = render(<CatalogScreen />);
  expect(getByTestId("lang-all")).toBeTruthy();
  expect(getByTestId("toggle-mature")).toBeTruthy();
});

test("pressing a language chip calls setPrefs with the current (loaded) prefs, not stale defaults", () => {
  const setPrefs = jest.fn();
  mockShelfPrefs = { prefs: { language: "all", hideMature: true }, setPrefs, loading: false };
  const { getByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("lang-en"));
  expect(setPrefs).toHaveBeenCalledWith({ language: "en", hideMature: true });
});

test("the catalog screen filters the shown entries by the current prefs and shows a count", () => {
  mockShelfPrefs = { prefs: { language: "fr", hideMature: true }, setPrefs: jest.fn(), loading: false };
  const { getByTestId, queryByTestId, getByText } = render(<CatalogScreen />);
  expect(queryByTestId("entry-a")).toBeNull(); // "en" filtered out
  expect(getByTestId("entry-b")).toBeTruthy(); // "fr-FR" -> "fr" kept
  expect(getByText("1 of 2 shown")).toBeTruthy();
});

test("mature entries are hidden when hideMature is true, and shown when false", () => {
  mockCatalog = { ...mockCatalog, entries: [entry("a", "en", true), entry("b", "en", false)] };
  mockShelfPrefs = { prefs: { language: "all", hideMature: true }, setPrefs: jest.fn(), loading: false };
  const { queryByTestId, rerender } = render(<CatalogScreen />);
  expect(queryByTestId("entry-a")).toBeNull();
  expect(queryByTestId("entry-b")).toBeTruthy();

  mockShelfPrefs = { prefs: { language: "all", hideMature: false }, setPrefs: jest.fn(), loading: false };
  rerender(<CatalogScreen />);
  expect(queryByTestId("entry-a")).toBeTruthy();
});
