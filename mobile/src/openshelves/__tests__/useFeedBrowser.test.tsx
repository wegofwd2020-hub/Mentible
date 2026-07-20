// mobile/src/openshelves/__tests__/useFeedBrowser.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useFeedBrowser, type BrowseFrame } from "../useFeedBrowser";

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

test("frame derives live from the root prop across re-renders (not seeded once at mount)", () => {
  const emptyRoot = { title: "", url: "", entries: [] };
  const populatedRoot = {
    title: "My Library",
    url: "https://ex.org/c.opds",
    entries: [entry({ id: "a" })],
  };
  const { result, rerender } = renderHook(
    ({ root }: { root: BrowseFrame }) => useFeedBrowser(root),
    { initialProps: { root: emptyRoot } },
  );
  expect(result.current.frame.title).toBe("");
  expect(result.current.frame.entries).toEqual([]);

  rerender({ root: populatedRoot });

  expect(result.current.frame.title).toBe("My Library");
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["a"]);
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

test("back() during an in-flight enter discards the late result", async () => {
  let resolveFetch: (xml: string) => void;
  const deferred = new Promise<string>((resolve) => { resolveFetch = resolve; });
  (fetchFeed as jest.Mock).mockReturnValue(deferred);
  (parseOpds12 as jest.Mock).mockReturnValue({ feedTitle: "Sub", entries: [entry({ id: "child" })] });
  const { result } = renderHook(() => useFeedBrowser(ROOT));

  let enterPromise!: Promise<void>;
  act(() => { enterPromise = result.current.enter(ROOT.entries[0]); });

  act(() => { result.current.back(); });

  await act(async () => {
    resolveFetch!("<feed/>");
    await enterPromise;
  });

  expect(result.current.canGoBack).toBe(false);
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["nav", "leaf"]);
  expect(result.current.error).toBeNull();
});

test("a second enter() while the first is in flight wins; the stale result is discarded", async () => {
  const entryA = entry({ id: "navA", title: "A", navigationUrl: "/subA.opds" });
  const entryB = entry({ id: "navB", title: "B", navigationUrl: "/subB.opds" });
  const rootAB = { ...ROOT, entries: [entryA, entryB] };

  let resolveA!: (xml: string) => void;
  const deferredA = new Promise<string>((resolve) => { resolveA = resolve; });
  (fetchFeed as jest.Mock).mockImplementation((url: string) => {
    if (url.endsWith("subA.opds")) return deferredA;
    return Promise.resolve("<feed-b/>");
  });
  (parseOpds12 as jest.Mock).mockImplementation((xml: string) => {
    if (xml === "<feed-b/>") return { feedTitle: "B", entries: [entry({ id: "childB" })] };
    return { feedTitle: "A", entries: [entry({ id: "childA" })] };
  });

  const { result } = renderHook(() => useFeedBrowser(rootAB));

  let enterAPromise!: Promise<void>;
  act(() => { enterAPromise = result.current.enter(entryA); });

  await act(async () => { await result.current.enter(entryB); });

  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["childB"]);
  expect(result.current.crumbs.length).toBe(2); // root + exactly one pushed level

  await act(async () => {
    resolveA("<feed-a/>");
    await enterAPromise;
  });

  // The late A result must not have pushed a second (or replacement) frame.
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["childB"]);
  expect(result.current.crumbs.length).toBe(2);
});
