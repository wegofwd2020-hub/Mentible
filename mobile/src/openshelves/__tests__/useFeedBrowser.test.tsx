// mobile/src/openshelves/__tests__/useFeedBrowser.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useFeedBrowser } from "../useFeedBrowser";

jest.mock("../fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("../opds12", () => ({ parseOpds12: jest.fn() }));
import { fetchFeed } from "../fetchFeed";
import { parseOpds12 } from "../opds12";

const entry = (over: any = {}) => ({
  id: "e", title: "t", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType: "other", rightsText: null, mature: null, links: [], canonicalUrl: null, navigationUrl: null, ...over,
});
const ROOT = { title: "Root", url: "https://ex.org/c.opds", entries: [entry({ id: "nav", navigationUrl: "/sub.opds" }), entry({ id: "leaf" })] };

beforeEach(() => jest.clearAllMocks());

test("enter a navigation entry pushes a frame of parsed sub-entries", async () => {
  (fetchFeed as jest.Mock).mockResolvedValue("<feed/>");
  (parseOpds12 as jest.Mock).mockReturnValue({ feedTitle: "Sub", entries: [entry({ id: "child" })] });
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  expect(fetchFeed).toHaveBeenCalledWith("https://ex.org/sub.opds"); // resolved against frame url
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["child"]);
  expect(result.current.canGoBack).toBe(true);
});

test("back pops to the parent frame", async () => {
  (fetchFeed as jest.Mock).mockResolvedValue("<feed/>");
  (parseOpds12 as jest.Mock).mockReturnValue({ feedTitle: "Sub", entries: [entry({ id: "child" })] });
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  act(() => { result.current.back(); });
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["nav", "leaf"]);
  expect(result.current.canGoBack).toBe(false);
});

test("entering a leaf entry does nothing (no navigationUrl)", async () => {
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[1]); });
  expect(fetchFeed).not.toHaveBeenCalled();
  expect(result.current.canGoBack).toBe(false);
});

test("a sub-feed fetch error sets error and keeps the stack", async () => {
  (fetchFeed as jest.Mock).mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  await waitFor(() => expect(result.current.error).toMatch(/boom/));
  expect(result.current.canGoBack).toBe(false);
});
