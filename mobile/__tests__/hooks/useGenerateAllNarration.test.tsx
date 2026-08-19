import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useGenerateAllNarration } from "@/hooks/useGenerateAllNarration";

const mockGen = jest.fn();
jest.mock("@/lib/audioGenerate", () => ({ generateAndStoreTopicAudio: (...a: any) => mockGen(...a), AudioGenerateError: class extends Error {} }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: true } }) }));

// Aliased for readability below — same jest.fn(), the `mock` prefix above is
// only to satisfy babel-jest's out-of-scope-variable guard on jest.mock().
const gen = mockGen;

const mk = (audio?: any[]) => ({ lesson: { synopsis: "s", sections: [], key_takeaways: [] }, ...(audio ? { audio } : {}) });
const book: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk([{ id: "x", file: "m", mime: "audio/mpeg" }]) } } };

beforeEach(() => gen.mockReset());

it("narrates only topics without audio (skips u2), persists each, finishes", async () => {
  gen.mockResolvedValue({ book, audio: { id: "n" } });
  const onBookChange = jest.fn();
  const { result } = renderHook(() => useGenerateAllNarration({ book, getApiKey: async () => "sk", onBookChange, intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.finished).toBe(true));
  expect(gen).toHaveBeenCalledTimes(1); // only u1
  expect(gen.mock.calls[0][0].topicId).toBe("u1");
  expect(result.current.doneCount).toBeGreaterThanOrEqual(1);
  expect(onBookChange).toHaveBeenCalled();
});

it("a per-topic failure marks that topic failed and continues", async () => {
  const b3: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk() } } };
  gen.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ book: b3, audio: { id: "n" } });
  const { result } = renderHook(() => useGenerateAllNarration({ book: b3, getApiKey: async () => "sk", onBookChange: jest.fn(), intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.finished).toBe(true));
  expect(result.current.failedCount).toBe(1);
  expect(result.current.doneCount).toBe(1);
});

it("cancel stops further topics", async () => {
  const b3: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk() } } };
  gen.mockImplementation(async () => { act(() => result.current.cancel()); return { book: b3, audio: { id: "n" } }; });
  const { result } = renderHook(() => useGenerateAllNarration({ book: b3, getApiKey: async () => "sk", onBookChange: jest.fn(), intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(false));
  expect(gen.mock.calls.length).toBeLessThan(2);
});
