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
    return Array.isArray(parsed) ? (parsed as FeedEntry[]) : [];
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
