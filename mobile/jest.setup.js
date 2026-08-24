// Global test setup. Provide a working in-memory AsyncStorage so modules that
// touch it (bookStore, settingsStore, …) can be imported/rendered in any test
// without the native module (which is null under jest).
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// @expo/vector-icons pulls in expo-font, which isn't initialised under jest
// (loadedNativeFonts.forEach throws). Render any icon set as a lightweight Text
// of its glyph name so screens using icons mount cleanly in tests.
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Icon = (props) => React.createElement(Text, null, (props && props.name) || "");
  return new Proxy({}, { get: (_t, prop) => (prop === "__esModule" ? false : Icon) });
});

// expo-audio's native module isn't registered under jest (no native runtime),
// and its index unconditionally reads a field off it at import time — any
// test that transitively imports AudioNarrationPlayer.tsx (i.e. renders
// posts.tsx in any mode, not just Audio) would otherwise crash at require()
// with "Cannot read properties of undefined (reading 'prototype')". Provide
// an inert default (never playing, no-op controls) here so every other
// Publish-tab test keeps working unmodified; tests that need real play/pause
// assertions (AudioNarrationPlayer.test.tsx, Publish.audio.test.tsx) declare
// their own jest.mock("expo-audio", …), which overrides this one for that file.
jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  useAudioPlayerStatus: jest.fn(() => ({ playing: false })),
}));

// jest's jsdom test environment (jest-environment-jsdom@29, jsdom@20) does not
// expose TextEncoder/TextDecoder on its global — a long-standing upstream gap
// (jestjs/jest#9983). Node's `jsdom` package (imported directly by tests that
// execute a WebView document in-process, e.g. topicSanitize.parity/e2e) needs
// them via whatwg-url. Polyfill from Node's `util` so those tests can import
// `jsdom` under a `@jest-environment jsdom` file without every test needing to
// know this.
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util");
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// react-native-aes-gcm-crypto (Inc 2.1 native EPUB crypto, ADR-014) has no
// native module registered under jest (no native runtime) — its default
// export is the raw NativeModules.AesGcmCrypto binding, which is undefined
// here. Any suite that imports epubFileCrypto (or a later integration test)
// would otherwise crash at require() time. Mock it as the ES module shape
// the glue code imports: `import AesGcmCrypto from "react-native-aes-gcm-crypto"`
// then `AesGcmCrypto.encryptFile(...)` / `.decryptFile(...)`.
jest.mock("react-native-aes-gcm-crypto", () => ({
  __esModule: true,
  default: { encryptFile: jest.fn(), decryptFile: jest.fn() },
}));
