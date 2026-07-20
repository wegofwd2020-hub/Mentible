import { renderHook, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNudge } from "../useNudge";
import * as store from "../nudgeStore";

beforeEach(async () => { await AsyncStorage.clear(); jest.restoreAllMocks(); });

it("starts hidden, becomes visible after load when not dismissed", async () => {
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  expect(result.current.visible).toBe(false); // hidden until load resolves
  await waitFor(() => expect(result.current.visible).toBe(true));
});

it("stays hidden when already dismissed", async () => {
  await store.dismissNudge("chapter-quiz");
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => {});
  expect(result.current.visible).toBe(false);
});

it("dismiss hides it and persists", async () => {
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => expect(result.current.visible).toBe(true));
  act(() => { result.current.dismiss(); });
  expect(result.current.visible).toBe(false);
  await waitFor(async () => expect(await store.loadDismissed()).toContain("chapter-quiz"));
});

it("fails closed when the load rejects", async () => {
  jest.spyOn(store, "loadDismissed").mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useNudge("chapter-quiz"));
  await waitFor(() => {});
  expect(result.current.visible).toBe(false);
});
