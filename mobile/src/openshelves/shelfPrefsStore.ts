// Device-local, declared filter prefs (ADR-028 §6b/F3). Never synced, never inferred.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deviceLocale } from "./deviceLocale";
import type { ShelfPrefs } from "./filterEntries";

const KEY = "sbq_open_shelves_prefs";

export function defaultPrefs(): ShelfPrefs {
  return { language: deviceLocale(), hideMature: true };
}

// Total: a corrupt/partial JSON blob AND an underlying storage-read failure
// (corrupted keystore, I/O error — real on-device) must both fall back to
// defaults. Never throw, never reject — the catalog screen depends on this.
export async function getPrefs(): Promise<ShelfPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return defaultPrefs();
    const p = JSON.parse(raw);
    if (typeof p?.language === "string" && typeof p?.hideMature === "boolean") {
      return { language: p.language, hideMature: p.hideMature };
    }
    return defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

export async function putPrefs(prefs: ShelfPrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
