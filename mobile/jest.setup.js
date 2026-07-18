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
