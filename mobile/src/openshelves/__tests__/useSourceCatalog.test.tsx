// mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useSourceCatalog } from "../useSourceCatalog";
import * as feedStore from "../feedStore";
import { putSource } from "../feedSourcesStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

// getSource/getEntries are jest.fn()s (so existing tests can drive them with
// mockResolvedValue/mockRejectedValue), but default to the real, AsyncStorage-
// backed implementation so the "lazy hydration" tests below — which seed via
// the real putSource and never touch these mocks — see genuine read-back.
jest.mock("../feedSourcesStore", () => {
  const actual = jest.requireActual("../feedSourcesStore");
  return { ...actual, getSource: jest.fn(actual.getSource) };
});
jest.mock("../feedEntriesStore", () => {
  const actual = jest.requireActual("../feedEntriesStore");
  return { ...actual, getEntries: jest.fn(actual.getEntries) };
});
jest.mock("../feedStore", () => ({ refreshSource: jest.fn() }));
const actualSourcesStore = jest.requireActual("../feedSourcesStore");
const actualEntriesStore = jest.requireActual("../feedEntriesStore");
import { getSource } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { refreshSource } from "../feedStore";

const source = { id: "s1", url: "https://ex.org/f", title: "Lib", addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 2 };
const entry = (id: string) => ({ id, title: id, authors: [], summary: "", coverUrl: null, language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null });

beforeEach(() => jest.clearAllMocks());

test("loads source + entries on mount", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValue([entry("a"), entry("b")]);
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.source?.title).toBe("Lib");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
});

test("refresh calls refreshSource then reloads", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValueOnce([entry("a")]).mockResolvedValueOnce([entry("a"), entry("c")]);
  (refreshSource as jest.Mock).mockResolvedValue({ added: 1, updated: 0, removed: 0 });
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.entries.length).toBe(1));
  await act(async () => { await result.current.refresh(); });
  expect(refreshSource).toHaveBeenCalledWith("s1");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "c"]);
});

test("a failing initial load surfaces an error and stops loading", async () => {
  (getSource as jest.Mock).mockRejectedValue(new Error("read failed"));
  (getEntries as jest.Mock).mockResolvedValue([]);
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("read failed");
});

describe("lazy hydration", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
    // getSource/getEntries are non-spy jest.fn()s (see jest.mock factories
    // above) so an earlier test's .mockResolvedValue/.mockRejectedValue
    // persists as their default — neither clearAllMocks nor restoreAllMocks
    // undoes that. Pin them back to the real, AsyncStorage-backed
    // implementation so these tests see genuine read-back of `putSource`.
    (getSource as jest.Mock).mockImplementation(actualSourcesStore.getSource);
    (getEntries as jest.Mock).mockImplementation(actualEntriesStore.getEntries);
  });

  it("fetches once on first open of a never-refreshed empty source", async () => {
    await putSource({ id: "s1", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: null, isStarter: true, entryCount: 0 });
    const spy = jest.spyOn(feedStore, "refreshSource").mockResolvedValue({ added: 1, updated: 0, removed: 0 });
    renderHook(() => useSourceCatalog("s1"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("does NOT loop when hydration fails", async () => {
    const seeded = { id: "s2", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: null, isStarter: true, entryCount: 0 };
    await putSource(seeded);
    const spy = jest.spyOn(feedStore, "refreshSource").mockRejectedValue(new Error("down"));
    const { result, rerender } = renderHook(() => useSourceCatalog("s2"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender({});
    rerender({});
    expect(spy).toHaveBeenCalledTimes(1); // terminal until user taps Refresh

    // Re-arm bait: a plain "same values" re-render (above) never changes the
    // `source`/`entries` object identity, so it can't tell a ref-guard apart
    // from React's own dependency-diffing doing the work for free. Force a
    // genuine reference change — via reload() — while lastRefreshedAt stays
    // null and entries stays empty: exactly the condition a naive (non-ref)
    // hydration check would treat as "never hydrated, go again". Only the
    // `hydratedFor` ref — not object equality — should keep this terminal.
    (getSource as jest.Mock).mockResolvedValueOnce({ ...seeded, lastRefreshedAt: null });
    (getEntries as jest.Mock).mockResolvedValueOnce([]);
    await act(async () => { await result.current.reload(); });

    expect(spy).toHaveBeenCalledTimes(1); // still terminal — guard survives a fresh source/entries reference
  });

  it("does NOT auto-fetch an already-refreshed source", async () => {
    await putSource({ id: "s3", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: "2026-01-01", isStarter: false, entryCount: 5 });
    const spy = jest.spyOn(feedStore, "refreshSource").mockResolvedValue({ added: 0, updated: 0, removed: 0 });
    renderHook(() => useSourceCatalog("s3"));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
