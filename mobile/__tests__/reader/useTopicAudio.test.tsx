import { renderHook, waitFor } from "@testing-library/react-native";
import { useTopicAudio } from "@/reader/useTopicAudio";

jest.mock("@/storage/mediaStore", () => ({
  resolveAudioDataUrls: jest.fn(async () => new Map([["a1", "data:audio/mpeg;base64,AAA="]])),
  resolveAudioFileUris: jest.fn(async () => new Map([["a1", "file:///m/a1.mp3"]])),
}));

const topic = { topicId: "u1", title: "T", generatedAt: "x", lesson: {} as any, audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg" }] } as any;

it("resolves both web data: and native file:// maps", async () => {
  const { result } = renderHook(() => useTopicAudio(topic));
  await waitFor(() => expect(result.current.webUrls.get("a1")).toContain("data:audio/mpeg"));
  expect(result.current.fileUris.get("a1")).toBe("file:///m/a1.mp3");
});

it("empty maps when the topic has no audio", async () => {
  const { result } = renderHook(() => useTopicAudio({ ...topic, audio: [] }));
  await waitFor(() => expect(result.current.webUrls.size).toBe(0));
  expect(result.current.fileUris.size).toBe(0);
});

it("a rejecting resolver resets the maps to empty (not stale) and does not throw", async () => {
  const mediaStore = require("@/storage/mediaStore");
  const { result, rerender } = renderHook<ReturnType<typeof useTopicAudio>, { t: typeof topic }>(
    ({ t }) => useTopicAudio(t), { initialProps: { t: topic } },
  );
  // First resolve succeeds — establishes non-empty maps so the next assertion
  // can tell "the .catch reset us" apart from "we never left the initial
  // empty state" (the hook's initial state is already EMPTY, so a rejection
  // on the very first render would prove nothing).
  await waitFor(() => expect(result.current.webUrls.get("a1")).toBe("data:audio/mpeg;base64,AAA="));

  const topic2 = { ...topic, topicId: "u2" }; // new identity → effect re-runs
  (mediaStore.resolveAudioFileUris as jest.Mock).mockRejectedValueOnce(new Error("boom"));
  rerender({ t: topic2 });

  await waitFor(() => expect(result.current.webUrls.size).toBe(0));
  expect(result.current.fileUris.size).toBe(0);
});
