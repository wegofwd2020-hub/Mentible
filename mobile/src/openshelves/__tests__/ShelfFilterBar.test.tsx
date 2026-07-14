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

// FIX 2: a drilled-in sub-feed may contain no entries in the currently-active
// language (e.g. root prefs.language="fr" carried into an all-English
// sub-feed). filterEntries correctly drops everything, but the chip list is
// derived only from the CURRENT frame's entries — so the selected "fr" chip
// used to vanish, leaving an empty list with no visible cue a filter is even
// active. The active pref must always render a chip, even with zero matches.
test("keeps the active language chip visible and selected when the frame has no matching entries", () => {
  const onChange = jest.fn();
  const englishOnly = [e("a", "en"), e("b", "en")];
  const { getByTestId } = render(
    <ShelfFilterBar entries={englishOnly} prefs={{ language: "fr", hideMature: true }} onChange={onChange} />,
  );
  const frChip = getByTestId("lang-fr");
  expect(frChip).toBeTruthy();
  expect(frChip.props.style[1]).toBeTruthy(); // chipOn applied — selected, not just present

  fireEvent.press(getByTestId("lang-all"));
  expect(onChange).toHaveBeenCalledWith({ language: "all", hideMature: true });
});
