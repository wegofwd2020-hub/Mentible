// The list of subscribed feed sources (spec P0-1). A single small JSON blob —
// labels + counts + timestamps, no entry payloads (those live in
// feedEntriesStore). Mirrors the shelfStore local-first pattern.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FeedSource } from "./types";

const SOURCES_KEY = "sbq_feed_sources";

export async function listSources(): Promise<FeedSource[]> {
  const raw = await AsyncStorage.getItem(SOURCES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedSource[]) : [];
  } catch {
    return [];
  }
}

export async function getSource(id: string): Promise<FeedSource | null> {
  return (await listSources()).find((s) => s.id === id) ?? null;
}

export async function putSource(source: FeedSource): Promise<void> {
  const all = await listSources();
  const idx = all.findIndex((s) => s.id === source.id);
  if (idx >= 0) all[idx] = source;
  else all.push(source);
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(all));
}

export async function deleteSourceRecord(id: string): Promise<void> {
  const all = await listSources();
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(all.filter((s) => s.id !== id)));
}
