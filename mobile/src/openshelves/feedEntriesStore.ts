// Per-source catalog entries (spec P0-3). One AsyncStorage blob per source, keyed
// by source id, so a single source's payload is bounded by the parser's
// MAX_ENTRIES. Metadata only — no content bytes. Migrate to expo-sqlite if real
// feeds outgrow AsyncStorage's per-key budget (same stance as bookStore.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FeedEntry } from "./types";

const entriesKey = (sourceId: string) => `sbq_feed_entries_${sourceId}`;

export async function getEntries(sourceId: string): Promise<FeedEntry[]> {
  const raw = await AsyncStorage.getItem(entriesKey(sourceId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Legacy-stored entries (pre-navigationUrl) lack the field entirely, which
    // would deserialize as `undefined`, not the `string | null` the type
    // promises. Normalize at the read boundary so old data can't be
    // misread by `=== null` / `!== null` checks downstream.
    return (parsed as FeedEntry[]).map((entry) => ({
      ...entry,
      navigationUrl: entry.navigationUrl ?? null,
    }));
  } catch {
    return [];
  }
}

export async function putEntries(sourceId: string, entries: FeedEntry[]): Promise<void> {
  await AsyncStorage.setItem(entriesKey(sourceId), JSON.stringify(entries));
}

export async function deleteEntries(sourceId: string): Promise<void> {
  await AsyncStorage.removeItem(entriesKey(sourceId));
}
