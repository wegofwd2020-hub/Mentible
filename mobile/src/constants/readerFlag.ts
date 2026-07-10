// Native web reader flag (spec 2026-07-09-native-web-reader-design.md, D1/D3).
//
// The web reader is being migrated off the sandboxed iframe onto real-DOM
// rendering. Until it reaches verified parity with the iframe — including the
// interactive quiz reveal that D6 defers to a fast-follow — the iframe stays the
// web default and this flag is OFF. Flipping the default here is the D1 "flip".
//
// Web-only by construction: the native (Android) renderer is react-native-webview
// and must never load DOMPurify/marked/mermaid, so no env var can turn this on
// off-web. Mirrors the IS_DEMO pattern in @/constants/demo.
import { Platform } from "react-native";

export const USE_NATIVE_WEB_READER =
  Platform.OS === "web" && process.env["EXPO_PUBLIC_NATIVE_READER"] === "1";
