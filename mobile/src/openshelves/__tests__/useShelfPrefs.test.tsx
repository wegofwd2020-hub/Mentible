import { renderHook, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useShelfPrefs } from "../useShelfPrefs";
import { defaultPrefs } from "../shelfPrefsStore";

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test("loads persisted prefs and clears loading", async () => {
  await AsyncStorage.setItem("sbq_open_shelves_prefs", JSON.stringify({ language: "fr", hideMature: false }));
  const { result } = renderHook(() => useShelfPrefs());
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.prefs).toEqual({ language: "fr", hideMature: false });
});

test("a rejecting initial load still clears loading and falls back to defaults", async () => {
  jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("keystore boom"));
  const { result } = renderHook(() => useShelfPrefs());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.prefs).toEqual(defaultPrefs());
});

test("setPrefs on success updates state and persists", async () => {
  const { result } = renderHook(() => useShelfPrefs());
  await waitFor(() => expect(result.current.loading).toBe(false));

  const next = { language: "es", hideMature: false };
  await act(async () => {
    await result.current.setPrefs(next);
  });

  expect(result.current.prefs).toEqual(next);
  expect(await AsyncStorage.getItem("sbq_open_shelves_prefs")).toBe(JSON.stringify(next));
});

test("setPrefs on a write failure reverts in-memory state and does not reject", async () => {
  const { result } = renderHook(() => useShelfPrefs());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const previous = result.current.prefs;

  jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));

  await act(async () => {
    await expect(result.current.setPrefs({ language: "de", hideMature: true })).resolves.toBeUndefined();
  });

  expect(result.current.prefs).toEqual(previous);
});

test("two same-render setPrefs calls revert to the first call's committed value, not the pre-both snapshot", async () => {
  const { result } = renderHook(() => useShelfPrefs());
  await waitFor(() => expect(result.current.loading).toBe(false));

  const A = { language: "es", hideMature: false };
  const B = { language: "fr", hideMature: true };

  jest
    .spyOn(AsyncStorage, "setItem")
    .mockResolvedValueOnce(undefined) // A succeeds
    .mockRejectedValueOnce(new Error("disk full")); // B fails

  // Same closure, both calls issued before any re-render can land between
  // them (no `await` separates the two invocations below).
  const setPrefs = result.current.setPrefs;
  await act(async () => {
    const p1 = setPrefs(A);
    const p2 = setPrefs(B);
    await Promise.all([p1, p2]);
  });

  // B's revert must land on A (the value committed by the call before it),
  // not on the pre-both value that was current when both closures ran.
  expect(result.current.prefs).toEqual(A);
});
