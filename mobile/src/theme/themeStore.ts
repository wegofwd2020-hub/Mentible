// Device-local theme preference (mirrors discovery/nudgeStore.ts). Parse-safe:
// any missing/corrupt/unknown value reads as null so the caller falls back to
// the default theme.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { themes, type ThemeName } from "@/constants/theme";

const KEY = "theme_name";

export async function loadThemeName(): Promise<ThemeName | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && raw in themes) return raw as ThemeName;
    return null;
  } catch {
    return null;
  }
}

export async function saveThemeName(name: ThemeName): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, name);
  } catch {
    /* device-local best-effort; never surface a storage error into the UI */
  }
}
