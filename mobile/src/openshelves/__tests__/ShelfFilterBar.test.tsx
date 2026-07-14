import { render, fireEvent } from "@testing-library/react-native";
import { ShelfFilterBar } from "../ShelfFilterBar";

const e = (id: string, language: string | null) => ({
  id, title: id, authors: [], summary: "", coverUrl: null, language, categories: [],
  mediaType: "book" as const, rightsText: null, mature: null, links: [], canonicalUrl: null, navigationUrl: null,
});
const entries = [e("a", "en"), e("b", "fr-FR"), e("c", null)];

test("offers All + the primary subtags present, and reports a language pick", () => {
  const onChange = jest.fn();
  const { getByTestId } = render(
    <ShelfFilterBar entries={entries} prefs={{ language: "all", hideMature: true }} onChange={onChange} />,
  );
  expect(getByTestId("lang-all")).toBeTruthy();
  expect(getByTestId("lang-en")).toBeTruthy();
  expect(getByTestId("lang-fr")).toBeTruthy();
  fireEvent.press(getByTestId("lang-fr"));
  expect(onChange).toHaveBeenCalledWith({ language: "fr", hideMature: true });
});

test("toggles hideMature", () => {
  const onChange = jest.fn();
  const { getByTestId } = render(
    <ShelfFilterBar entries={entries} prefs={{ language: "all", hideMature: true }} onChange={onChange} />,
  );
  fireEvent.press(getByTestId("toggle-mature"));
  expect(onChange).toHaveBeenCalledWith({ language: "all", hideMature: false });
});
