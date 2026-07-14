// Primary language subtag for the device, as the DEFAULT filter language. Declared,
// not tracked (ADR-028 §6b): it only seeds the default; the user changes it in the
// filter bar. No expo-localization dependency (spec F4).
import { Platform } from "react-native";

export function deviceLocale(raw?: string): string {
  let value = raw;
  if (value === undefined) {
    try {
      if (Platform.OS === "web") {
        value = (globalThis as any).navigator?.language;
      } else {
        value = Intl.DateTimeFormat().resolvedOptions().locale;
      }
    } catch {
      value = undefined;
    }
  }
  const primary = (value ?? "").split(/[-_]/)[0].trim().toLowerCase();
  return primary || "en";
}
