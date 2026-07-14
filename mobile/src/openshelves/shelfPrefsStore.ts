// Device-local, declared filter prefs (ADR-028 §6b/F3). Never synced, never inferred.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deviceLocale } from "./deviceLocale";
import type { ShelfPrefs } from "./filterEntries";

const KEY = "sbq_open_shelves_prefs";

export function defaultPrefs(): ShelfPrefs {
  return { language: deviceLocale(), hideMature: true };
}

export async function getPrefs(): Promise<ShelfPrefs> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return defaultPrefs();
  try {
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
