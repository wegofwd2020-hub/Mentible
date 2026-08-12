import { renderHook, act } from "@testing-library/react-native";
import { useElapsedMs } from "@/hooks/useElapsedMs";

jest.useFakeTimers();

it("returns 0 when startedAt is null and ticks up while set", () => {
  const t0 = 10_000;
  jest.setSystemTime(t0);
  const { result, rerender } = renderHook(({ s }: { s: number | null }) => useElapsedMs(s), {
    initialProps: { s: null as number | null },
  });
  expect(result.current).toBe(0);
  rerender({ s: t0 });
  act(() => { jest.setSystemTime(t0 + 2_000); jest.advanceTimersByTime(2_000); });
  expect(result.current).toBeGreaterThanOrEqual(2_000);
  rerender({ s: null });
  expect(result.current).toBe(0);
});
