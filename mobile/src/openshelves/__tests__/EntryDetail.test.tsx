import { render, fireEvent } from "@testing-library/react-native";
import { EntryDetail } from "../EntryDetail";
import type { FeedEntry } from "../types";

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Moby Dick", authors: ["Herman Melville"], summary: "A whale.", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: "Public Domain", mature: null,
  links: [], canonicalUrl: "https://ex.org/moby", ...over,
});

test("shows provenance: source, rights, and view-at-source", () => {
  const onView = jest.fn();
  const { getByText, getByTestId } = render(<EntryDetail entry={entry()} sourceTitle="My Library" onViewAtSource={onView} />);
  expect(getByText("Moby Dick")).toBeTruthy();
  expect(getByText(/My Library/)).toBeTruthy();
  expect(getByText(/Public Domain/)).toBeTruthy();
  fireEvent.press(getByTestId("view-at-source"));
  expect(onView).toHaveBeenCalledWith("https://ex.org/moby");
});

test("renders 'Not stated by source' when rights are absent, never invents a license", () => {
  const { getByText } = render(<EntryDetail entry={entry({ rightsText: null })} sourceTitle="Lib" onViewAtSource={jest.fn()} />);
  expect(getByText(/not stated by source/i)).toBeTruthy();
});

test("hides view-at-source when there is no canonical url", () => {
  const { queryByTestId } = render(<EntryDetail entry={entry({ canonicalUrl: null })} sourceTitle="Lib" onViewAtSource={jest.fn()} />);
  expect(queryByTestId("view-at-source")).toBeNull();
});
