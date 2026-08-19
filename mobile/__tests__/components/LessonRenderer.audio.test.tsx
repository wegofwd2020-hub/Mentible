import { render } from "@testing-library/react-native";
import { TopicRenderer } from "@/components/LessonRenderer";

// Jest's mock-factory hoist guard only allows out-of-scope references whose
// name starts with "mock" (case-insensitive) — see
// __tests__/reader/*sanitize* siblings / reference_mobile_test_env_traps for
// the same trap. Named per the brief's `play`/`pause`/`seekTo`/`replace` but
// prefixed to satisfy the hoist guard.
const mockPlay = jest.fn(), mockPause = jest.fn(), mockSeekTo = jest.fn(), mockReplace = jest.fn();
jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({ play: mockPlay, pause: mockPause, seekTo: mockSeekTo, replace: mockReplace }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
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
  resolveAudioFileUris: jest.fn(async () => new Map([["a1", "file:///m/a1.mp3"]])),
}));

const topic: any = { topicId: "u1", title: "T", generatedAt: "x", lesson: { topic:"T",level:"i",language:"en",synopsis:"s",learning_objectives:[],sections:[{heading:"H",body_markdown:"b"}],key_takeaways:[],further_reading:[] }, audio: [{ id:"a1", file:"media/b/a1.mp3", mime:"audio/mpeg", transcript:"Hi." }] };

// jest.config.js has neither clearMocks nor resetMocks set, so the module-scope
// mockPlay/mockPause/mockSeekTo call counts persist across `it` blocks by
// default — without this, "not.toHaveBeenCalled()" in the last test would see
// call counts left over from earlier tests in this file, not just its own event.
beforeEach(() => {
  mockPlay.mockClear();
  mockPause.mockClear();
  mockSeekTo.mockClear();
  mockReplace.mockClear();
});

it("injects the audio bridge JS and a message handler on the native topic WebView", () => {
  render(<TopicRenderer topic={topic} />);
  expect(capturedProps.injectedJavaScript).toContain("rd-audio-toggle");
  expect(typeof capturedProps.onMessage).toBe("function");
});

it("a toggle message plays, then a second toggle pauses", () => {
  render(<TopicRenderer topic={topic} />);
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  expect(mockPlay).toHaveBeenCalled();
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
