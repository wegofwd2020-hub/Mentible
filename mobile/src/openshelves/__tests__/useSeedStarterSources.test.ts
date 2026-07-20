import { renderHook } from "@testing-library/react-native";
import { useSeedStarterSources } from "@/hooks/useSeedStarterSources";
import * as seed from "../seedStarterSources";

it("calls seedStarterSources once on mount and swallows errors", async () => {
  const spy = jest.spyOn(seed, "seedStarterSources").mockRejectedValue(new Error("boom"));
  renderHook(() => useSeedStarterSources());
  expect(spy).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  spy.mockRestore();
});
