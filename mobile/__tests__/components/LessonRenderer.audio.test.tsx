import { act, render } from "@testing-library/react-native";
import { TopicRenderer } from "@/components/LessonRenderer";

// Jest's mock-factory hoist guard only allows out-of-scope references whose
// name starts with "mock" (case-insensitive) — see
// __tests__/reader/*sanitize* siblings / reference_mobile_test_env_traps for
// the same trap. Named per the brief's `play`/`pause`/`seekTo`/`replace` but
// prefixed to satisfy the hoist guard.
const mockPlay = jest.fn(), mockPause = jest.fn(), mockSeekTo = jest.fn(), mockReplace = jest.fn();
// `useAudioPlayerStatus` is a jest.fn (not an inline arrow) so individual
// tests can `mockReturnValue`/`mockReturnValueOnce` a "clip already playing"
// status to exercise the switch-while-playing case.
const mockUseAudioPlayerStatus = jest.fn(() => ({ playing: false, currentTime: 0, duration: 0 }));
jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({ play: mockPlay, pause: mockPause, seekTo: mockSeekTo, replace: mockReplace }),
  useAudioPlayerStatus: () => mockUseAudioPlayerStatus(),
}));
let capturedProps: any = {};
// `mobile/src/components/LessonRenderer.tsx` imports the default export
// (`require("react-native-webview").default`), per the convention every
// sibling WebView-consuming test in this repo already mocks against
// (__tests__/screens/*.test.tsx, __tests__/components/TopicRenderer.switch.test.tsx).
jest.mock("react-native-webview", () => ({
  default: (props: any) => { capturedProps = props; return null; },
  WebView: (props: any) => { capturedProps = props; return null; },
}));
// react-native's `Platform` export is `require('./Libraries/Utilities/Platform').default`
// (see node_modules/react-native/index.js) — the mock must supply that `default`
// key (a `select` with the real `default:` fallback theme.ts relies on for keys
// with no `android` entry), not just named exports, or every downstream
// `Platform.select(...)` call in the render tree throws on undefined.
jest.mock("react-native/Libraries/Utilities/Platform", () => {
  const platform = { OS: "android", select: (o: any) => (o.android !== undefined ? o.android : o.default) };
  return { __esModule: true, default: platform, OS: platform.OS, select: platform.select };
});
jest.mock("@/storage/mediaStore", () => ({
  resolveAudioDataUrls: jest.fn(async () => new Map()),
  resolveAudioFileUris: jest.fn(async () => new Map([["a1", "file:///m/a1.mp3"], ["a2", "file:///m/a2.mp3"]])),
}));

const topic: any = { topicId: "u1", title: "T", generatedAt: "x", lesson: { topic:"T",level:"i",language:"en",synopsis:"s",learning_objectives:[],sections:[{heading:"H",body_markdown:"b"}],key_takeaways:[],further_reading:[] }, audio: [{ id:"a1", file:"media/b/a1.mp3", mime:"audio/mpeg", transcript:"Hi." }, { id:"a2", file:"media/b/a2.mp3", mime:"audio/mpeg", transcript:"Bye." }] };

// jest.config.js has neither clearMocks nor resetMocks set, so the module-scope
// mockPlay/mockPause/mockSeekTo call counts persist across `it` blocks by
// default — without this, "not.toHaveBeenCalled()" in the last test would see
// call counts left over from earlier tests in this file, not just its own event.
beforeEach(() => {
  mockPlay.mockClear();
  mockPause.mockClear();
  mockSeekTo.mockClear();
  mockReplace.mockClear();
  mockUseAudioPlayerStatus.mockReset().mockReturnValue({ playing: false, currentTime: 0, duration: 0 });
});

it("injects the audio bridge JS and a message handler on the native topic WebView", () => {
  render(<TopicRenderer topic={topic} />);
  expect(capturedProps.injectedJavaScript).toContain("rd-audio-toggle");
  expect(typeof capturedProps.onMessage).toBe("function");
});

it("a toggle message on a not-yet-active clip plays", () => {
  render(<TopicRenderer topic={topic} />);
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  expect(mockPlay).toHaveBeenCalled();
  expect(mockPause).not.toHaveBeenCalled();
});

it("toggling the SAME already-playing clip pauses it", () => {
  mockUseAudioPlayerStatus.mockReturnValue({ playing: true, currentTime: 3, duration: 10 });
  render(<TopicRenderer topic={topic} />);
  // Establish a1 as the active clip first (a real session reaches "already
  // active + playing" via a prior toggle; status is mocked to "playing" for
  // every render here, so this call is the one under test).
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  expect(mockPause).toHaveBeenCalled();
});

// Task-3-review fix: switching to a DIFFERENT clip while one is already
// playing must START the new clip, not pause it. Before the fix,
// `activeId.current` was reassigned to the new id BEFORE the play/pause
// decision, so `activeId.current === m.id` was always true post-reassignment
// and the stale `status.playing===true` (still describing the PREVIOUS clip)
// drove a `pause()` call on the freshly-`replace()`d new clip instead of
// `play()`.
it("tapping a DIFFERENT clip while one is playing replaces the source and plays it (not pause)", async () => {
  mockUseAudioPlayerStatus.mockReturnValue({ playing: true, currentTime: 3, duration: 10 });
  render(<TopicRenderer topic={topic} />);
  // `useTopicAudio` resolves `fileUris` from the mocked (async)
  // `resolveAudioFileUris` via a `useEffect` promise chain — flush it before
  // firing bridge messages so `player.replace({ uri })` has a real uri to
  // assert against (see __tests__/reader/useTopicAudio.test.tsx for the same
  // async-resolution shape).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // a1 becomes active first (status mocked "playing" throughout, standing in
  // for "a1 is already playing" at the moment the user taps a2).
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  mockPlay.mockClear();
  mockPause.mockClear();
  mockReplace.mockClear();
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a2" }) } });
  expect(mockReplace).toHaveBeenCalledWith({ uri: "file:///m/a2.mp3" });
  expect(mockPlay).toHaveBeenCalled();
  expect(mockPause).not.toHaveBeenCalled();
});

it("a seek message calls seekTo with seconds", () => {
  render(<TopicRenderer topic={topic} />);
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "seek", id: "a1", positionMs: 5000 }) } });
  expect(mockSeekTo).toHaveBeenCalledWith(5);
});

it("a bare-number height message still auto-heights (not misrouted to audio)", () => {
  render(<TopicRenderer topic={topic} inline />);
  expect(() => capturedProps.onMessage({ nativeEvent: { data: "420" } })).not.toThrow();
  expect(mockPlay).not.toHaveBeenCalled();
});
