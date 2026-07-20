import { render, fireEvent } from "@testing-library/react-native";
import { EntryRow } from "../EntryRow";
import type { FeedEntry } from "../types";

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Moby Dick", authors: ["Herman Melville"], summary: "", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null,
  navigationUrl: null, ...over,
});

test("renders title, author, and media badge", () => {
  const { getByText } = render(<EntryRow entry={entry()} onPress={jest.fn()} />);
  expect(getByText("Moby Dick")).toBeTruthy();
  expect(getByText("Herman Melville")).toBeTruthy();
  expect(getByText(/book/i)).toBeTruthy();
});

test("falls back to 'Unknown author' with no authors", () => {
  const { getByText } = render(<EntryRow entry={entry({ authors: [] })} onPress={jest.fn()} />);
  expect(getByText(/unknown author/i)).toBeTruthy();
});

test("press calls onPress with the entry id", () => {
  const onPress = jest.fn();
  const { getByTestId } = render(<EntryRow entry={entry()} onPress={onPress} />);
  fireEvent.press(getByTestId("entry-e1"));
  expect(onPress).toHaveBeenCalledWith("e1");
});

const nav = (over = {}) => ({
  id: "n1", title: "Whale books", authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "other" as const, rightsText: null, mature: null, links: [],
  canonicalUrl: null, navigationUrl: "/sub.opds", ...over,
});

test("a navigation entry shows a Browse affordance, not a media badge", () => {
  const { getByTestId, queryByText } = render(<EntryRow entry={nav()} onPress={jest.fn()} />);
  expect(getByTestId("entry-browse")).toBeTruthy();
  expect(queryByText("other")).toBeNull();
});

test("a leaf entry shows its media badge, no Browse affordance", () => {
  const leaf = nav({ navigationUrl: null, mediaType: "book" as const,
    links: [{ href: "/a.epub", mimeType: "application/epub+zip", rel: "acquisition" }] });
  const { getByText, queryByTestId } = render(<EntryRow entry={leaf} onPress={jest.fn()} />);
  expect(getByText("book")).toBeTruthy();
  expect(queryByTestId("entry-browse")).toBeNull();
});
