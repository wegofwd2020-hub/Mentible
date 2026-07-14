import { render, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
let mockCatalog: any;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sourceId: "s1" }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => mockCatalog }));
jest.mock("@/openshelves/fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("@/openshelves/opds12", () => ({ parseOpds12: jest.fn() }));
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
