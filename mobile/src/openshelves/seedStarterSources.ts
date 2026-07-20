// First-run seeder for the owner-curated starter shelves (spec P0-5, ADR-028).
// Writes FeedSource rows directly — NO network at startup (D-S4). Idempotent and
// deletion-safe via a persisted marker of seeded URLs (D-S3): a removed shelf is
// not resurrected. Fetch happens lazily on first open (useSourceCatalog).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "@/lib/uuid";
import type { FeedSource } from "./types";
import { STARTER_SOURCES } from "./starterSources";
import { listSources, putSource } from "./feedSourcesStore";

const MARKER_KEY = "sbq_seeded_shelves";

export interface SeedResult { seeded: string[]; skipped: string[] }
export interface SeedStarterOpts { now?: () => string; newId?: () => string }

async function loadMarker(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(MARKER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function saveMarker(urls: string[]): Promise<void> {
  await AsyncStorage.setItem(MARKER_KEY, JSON.stringify(urls));
}

function newRow(url: string, title: string, opts: SeedStarterOpts): FeedSource {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? randomUUID;
  return { id: newId(), url, title, addedAt: now(), lastRefreshedAt: null, isStarter: true, entryCount: 0 };
}

/** Seed starter shelves not yet marked. Idempotent + deletion-safe. No network. */
export async function seedStarterSources(opts: SeedStarterOpts = {}): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  const marker = await loadMarker();
  for (const src of STARTER_SOURCES) {
    if (marker.includes(src.url)) { result.skipped.push(src.url); continue; }
    await putSource(newRow(src.url, src.title, opts));
    marker.push(src.url);
    result.seeded.push(src.url);
  }
  if (result.seeded.length > 0) await saveMarker(marker);
  return result;
}

/** Re-add starter shelves the user removed, without clobbering kept ones. */
export async function restoreStarterSources(opts: SeedStarterOpts = {}): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  const present = new Set((await listSources()).map((s) => s.url));
  const marker = await loadMarker();
  for (const src of STARTER_SOURCES) {
    if (present.has(src.url)) { result.skipped.push(src.url); continue; }
    await putSource(newRow(src.url, src.title, opts));
    if (!marker.includes(src.url)) marker.push(src.url);
    result.seeded.push(src.url);
  }
  if (result.seeded.length > 0) await saveMarker(marker);
  return result;
}
