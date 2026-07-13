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

test("shows a Download button when canDownload and calls onDownload", () => {
  const onDownload = jest.fn();
  const { getByTestId } = render(
    <EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload onDownload={onDownload} downloadState="idle" />,
  );
  fireEvent.press(getByTestId("download-entry"));
  expect(onDownload).toHaveBeenCalled();
});

test("no Download button when canDownload is false (e.g. video)", () => {
  const { queryByTestId } = render(
    <EntryDetail entry={entry({ mediaType: "video" })} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload={false} />,
  );
  expect(queryByTestId("download-entry")).toBeNull();
});

test("no Download button by default (the screen must opt in)", () => {
  const { queryByTestId } = render(<EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} />);
  expect(queryByTestId("download-entry")).toBeNull();
});

test("while downloading the button is busy and cannot be pressed twice", () => {
  const onDownload = jest.fn();
  const { getByTestId } = render(
    <EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload onDownload={onDownload} downloadState="downloading" />,
  );
  fireEvent.press(getByTestId("download-entry"));
  expect(onDownload).not.toHaveBeenCalled();
});

test("a finished download says where the file lives (P0-10 storage location)", () => {
  const { getByText } = render(
    <EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload onDownload={jest.fn()} downloadState="done" />,
  );
  expect(getByText(/saved on this device/i)).toBeTruthy();
  expect(getByText(/downloads/i)).toBeTruthy();
});

test("a web browser download says it is NOT in-app offline storage", () => {
  const { getByText } = render(
    <EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload onDownload={jest.fn()} downloadState="browser" />,
  );
  expect(getByText(/browser/i)).toBeTruthy();
  expect(getByText(/not stored in the app/i)).toBeTruthy();
});

test("an error surfaces the failure message", () => {
  const { getByText } = render(
    <EntryDetail
      entry={entry()}
      sourceTitle="Lib"
      onViewAtSource={jest.fn()}
      canDownload
      onDownload={jest.fn()}
      downloadState="error"
      downloadError="Download failed: HTTP 404."
    />,
  );
  expect(getByText(/HTTP 404/)).toBeTruthy();
});
