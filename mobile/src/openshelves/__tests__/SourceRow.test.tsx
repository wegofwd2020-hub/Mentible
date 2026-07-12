import { render, fireEvent } from "@testing-library/react-native";
import { SourceRow } from "../SourceRow";
import type { FeedSource } from "../types";

const src = (over: Partial<FeedSource> = {}): FeedSource => ({
  id: "s1", url: "https://ex.org/f", title: "My Library", addedAt: "T0",
  lastRefreshedAt: null, isStarter: false, entryCount: 12, ...over,
});

test("renders title, count, and 'Never' when unrefreshed", () => {
  const { getByText } = render(<SourceRow source={src()} onRefresh={jest.fn()} onRemove={jest.fn()} />);
  expect(getByText("My Library")).toBeTruthy();
  expect(getByText(/12 items/)).toBeTruthy();
  expect(getByText(/Never/)).toBeTruthy();
});

test("falls back to url when title is null", () => {
  const { getByText } = render(<SourceRow source={src({ title: null })} onRefresh={jest.fn()} onRemove={jest.fn()} />);
  expect(getByText("https://ex.org/f")).toBeTruthy();
});

test("refresh and remove buttons call callbacks with the id", () => {
  const onRefresh = jest.fn(); const onRemove = jest.fn();
  const { getByTestId } = render(<SourceRow source={src()} onRefresh={onRefresh} onRemove={onRemove} />);
  fireEvent.press(getByTestId("refresh-s1"));
  fireEvent.press(getByTestId("remove-s1"));
  expect(onRefresh).toHaveBeenCalledWith("s1");
  expect(onRemove).toHaveBeenCalledWith("s1");
});

test("pressing the title/meta area calls onOpen with the id", () => {
  const onOpen = jest.fn();
  const { getByTestId } = render(
    <SourceRow source={src()} onRefresh={jest.fn()} onRemove={jest.fn()} onOpen={onOpen} />
  );
  fireEvent.press(getByTestId("open-s1"));
  expect(onOpen).toHaveBeenCalledWith("s1");
});
