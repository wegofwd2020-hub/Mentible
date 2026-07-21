// Persisted set of dismissed discovery-nudge keys (F3). Mirrors the seed-marker
// style (seedStarterSources). Parse-safe; a corrupt blob reads as empty.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "sbq_dismissed_nudges";

export async function loadDismissed(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function dismissNudge(key: string): Promise<void> {
  const cur = await loadDismissed();
  if (cur.includes(key)) return;
  cur.push(key);
  await AsyncStorage.setItem(KEY, JSON.stringify(cur));
}
