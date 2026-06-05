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
