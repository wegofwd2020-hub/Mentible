import { Alert } from "react-native";

// Demo build flag. Baked in only for the distributable DEMO APK
// (EXPO_PUBLIC_DEMO_MODE=1). In a demo build there is no backend and no accounts:
// the app showcases the bundled books for reading, and backend-dependent features
// (generate / author / sign-in) are gated behind a friendly notice instead of
// failing with timeouts or connection errors.
export const IS_DEMO = process.env["EXPO_PUBLIC_DEMO_MODE"] === "1";

const DEMO_MESSAGE =
  "This is a demo build. It showcases the included books for reading — generating new " +
  "content, authoring, and accounts aren't available in the demo.";

// If running as a demo, show the notice and return true so the caller can stop.
// No-op (returns false) in a normal build. Usage: `if (demoBlocked()) return;`
export function demoBlocked(title = "Demo version"): boolean {
  if (!IS_DEMO) return false;
  Alert.alert(title, DEMO_MESSAGE);
  return true;
}
