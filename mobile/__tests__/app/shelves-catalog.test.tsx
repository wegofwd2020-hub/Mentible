import { render, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
let mockCatalog: any;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sourceId: "s1" }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => mockCatalog }));
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
