// mobile/src/openshelves/__tests__/useOpenShelves.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useOpenShelves } from "../useOpenShelves";
import { FeedSourceError } from "../errors";

jest.mock("../feedSourcesStore", () => ({ listSources: jest.fn() }));
jest.mock("../feedStore", () => ({
  addSource: jest.fn(), removeSource: jest.fn(), refreshSource: jest.fn(), refreshAll: jest.fn(),
}));
import { listSources } from "../feedSourcesStore";
import { addSource, removeSource } from "../feedStore";

const src = (id: string) => ({ id, url: `https://ex.org/${id}`, title: id, addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 1 });

beforeEach(() => jest.clearAllMocks());

test("loads sources on mount", async () => {
  (listSources as jest.Mock).mockResolvedValue([src("a")]);
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sources.map((s) => s.id)).toEqual(["a"]);
});

test("add success reloads the list and returns true", async () => {
  (listSources as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([src("a")]);
  (addSource as jest.Mock).mockResolvedValue(src("a"));
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.add("https://ex.org/a"); });
  expect(ok).toBe(true);
  expect(result.current.sources.map((s) => s.id)).toEqual(["a"]);
  expect(result.current.error).toBeNull();
});

test("add maps an authRequired error and returns false", async () => {
  (listSources as jest.Mock).mockResolvedValue([]);
  (addSource as jest.Mock).mockRejectedValue(new FeedSourceError("x", { authRequired: true }));
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.add("https://ex.org/a"); });
  expect(ok).toBe(false);
  expect(result.current.error).toBe("Authenticated repos aren't supported yet.");
});

test("remove reloads the list", async () => {
  (listSources as jest.Mock).mockResolvedValueOnce([src("a")]).mockResolvedValueOnce([]);
  (removeSource as jest.Mock).mockResolvedValue(undefined);
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.sources.length).toBe(1));
  await act(async () => { await result.current.remove("a"); });
  expect(result.current.sources).toEqual([]);
});

test("remove maps an error instead of leaving it unhandled", async () => {
  (listSources as jest.Mock).mockResolvedValue([src("a")]);
  (removeSource as jest.Mock).mockRejectedValue(new Error("delete failed"));
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.sources.length).toBe(1));
  await act(async () => { await result.current.remove("a"); });
  expect(result.current.error).toBe("delete failed");
});
