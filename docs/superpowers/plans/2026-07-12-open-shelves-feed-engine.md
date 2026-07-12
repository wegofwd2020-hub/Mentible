# Open Shelves — Feed Engine Core (ADR-028, plan 1 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, platform-agnostic **feed engine** for Open Shelves — the `validate → fetch_feed → parse_entries` seam (spec P0-2), a hardened OPDS 1.2 parser (the attack surface, spec §7), the entry/source schema (P0-3), plaintext normalization, and the idempotent upsert/prune reconcile (P0-4) — all unit-tested with canned fixtures, **no UI, no persistence engine, no network in tests.**

**Architecture:** A new feature module `mobile/src/openshelves/` of pure TypeScript functions (no React, no DOM, no persistence), so it tests cleanly under jest-expo without RNTL or jsdom. XML is parsed with `fast-xml-parser` (pure JS, Hermes-safe, no external-entity resolution → XXE-safe by construction). Feed strings are normalized to **plaintext** at parse; HTML *rendering* (a later UI plan) reuses the web-only `sanitizeFragment`. This plan is the foundation every later Open Shelves plan (store persistence, Sources UI, starter list, refresh UI, browse/provenance, downloads, language filter) builds on.

**Tech Stack:** TypeScript, `fast-xml-parser`, jest-expo. Branch: `feat/open-shelves` (localhost-only; never deployed — see `docs/open-shelves-branch.md`).

## Global Constraints

- **Location:** all code in `mobile/src/openshelves/`; tests co-located in `mobile/src/openshelves/__tests__/`. Pure TS only — **no React, no DOM APIs, no `DOMParser`, no persistence** in this plan.
- **XML parser:** `fast-xml-parser`, configured with `processEntities: false` (no entity expansion) and no external-DTD fetching. **Never** use `DOMParser` (absent in Hermes) or any parser that resolves external entities — this is the XXE guarantee (spec §7).
- **Feed strings are untrusted.** Normalize every rendered feed string to **plaintext** at parse via `toPlainText` (decode named/numeric entities, strip tags). This is normalization, **not** a second HTML sanitizer — HTML *rendering* on web (a later UI plan) reuses `sanitizeFragment` from `mobile/src/reader/sanitize.ts` (web-only). Never import `sanitize.ts` here.
- **HTTPS-only** feed URLs (spec P0-8). A non-https URL → `FeedSourceError`. A `401`/`403` → `FeedSourceError` with `authRequired: true` and the specific message (spec P0-9). Never send auth.
- **Caps** (spec P0-8 / §7 metadata budget): `MAX_FEED_BYTES = 8 * 1024 * 1024`; `MAX_ENTRIES = 5000` (parse stops past this — paginate later, never slurp); `MAX_FIELD_LEN = 4096` (per-field plaintext ceiling). Exceeding a hard limit → `FeedParseError`.
- **OPDS 1.2 (Atom) only** in this slice (spec P0-2). A document that isn't recognizably OPDS/Atom → `FeedParseError` whose message names **OPDS** and refers the user to **support_mentible@mambakkam.net** (spec verbatim intent).
- **Typed errors** mirror the house pattern (`PublishError`/`CompilerError`): `FeedSourceError`, `FeedParseError`, `FeedRefreshError`, all extending `Error` with a stable `name`.
- **Reconcile** (spec P0-4) keys on the Atom entry `id`; upsert by id, prune entries absent from the new fetch, never duplicate. Pure function over arrays — no store.
- **No content payloads** anywhere (spec P0-3) — only metadata fields. **No live network in tests** — mock `fetch`; parser tests use canned fixture strings.

---

### Task 1: Schema, typed errors, and the parser dependency

**Files:**
- Create: `mobile/src/openshelves/types.ts`
- Create: `mobile/src/openshelves/errors.ts`
- Modify: `mobile/package.json` (add `fast-xml-parser` to `dependencies`)
- Test: `mobile/src/openshelves/__tests__/errors.test.ts`

**Interfaces:**
- Produces:
  - `type MediaType = "book" | "audio" | "video" | "other"`
  - `interface AcquisitionLink { href: string; mimeType: string; rel: string }`
  - `interface FeedEntry { id: string; title: string; authors: string[]; summary: string; coverUrl: string | null; language: string | null; categories: string[]; mediaType: MediaType; rightsText: string | null; mature: boolean | null; links: AcquisitionLink[]; canonicalUrl: string | null }`
  - `interface FeedSource { id: string; url: string; title: string | null; addedAt: string; lastRefreshedAt: string | null; isStarter: boolean }`
  - `class FeedSourceError extends Error` with `authRequired?: boolean`
  - `class FeedParseError extends Error`
  - `class FeedRefreshError extends Error`

- [ ] **Step 1: Add the dependency**

Run: `cd mobile && npm install fast-xml-parser@^4`
Expected: `fast-xml-parser` appears under `dependencies` in `mobile/package.json`; `npm ls fast-xml-parser` resolves.

- [ ] **Step 2: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/errors.test.ts
import { FeedSourceError, FeedParseError, FeedRefreshError } from "../errors";

test("error classes carry a stable name and message", () => {
  expect(new FeedParseError("bad").name).toBe("FeedParseError");
  expect(new FeedRefreshError("x").message).toBe("x");
  expect(new FeedParseError("y")).toBeInstanceOf(Error);
});

test("FeedSourceError can flag authRequired", () => {
  const e = new FeedSourceError("needs login", { authRequired: true });
  expect(e.name).toBe("FeedSourceError");
  expect(e.authRequired).toBe(true);
  expect(new FeedSourceError("plain").authRequired).toBeUndefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/errors.test.ts`
Expected: FAIL — cannot find module `../errors`.

- [ ] **Step 4: Write the implementation**

```typescript
// mobile/src/openshelves/errors.ts
// Typed errors for the Open Shelves feed engine — mirrors the backend house
// pattern (PublishError / CompilerError): a distinct class per failure kind with
// a stable `name`, so callers branch on type and the UI maps each to copy.

export class FeedSourceError extends Error {
  authRequired?: boolean;
  constructor(message: string, opts?: { authRequired?: boolean }) {
    super(message);
    this.name = "FeedSourceError";
    if (opts?.authRequired) this.authRequired = true;
  }
}

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export class FeedRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedRefreshError";
  }
}
```

```typescript
// mobile/src/openshelves/types.ts
// Open Shelves catalog schema (spec P0-3). Metadata only — NEVER content payloads.
// All string fields are plaintext-normalized at parse (spec §7); `links` carry
// content URLs but no bytes are stored.

export type MediaType = "book" | "audio" | "video" | "other";

export interface AcquisitionLink {
  href: string;
  mimeType: string; // e.g. "application/epub+zip"
  rel: string; // OPDS/Atom link rel
}

export interface FeedEntry {
  id: string; // Atom entry id — the stable reconcile key (spec P0-4)
  title: string;
  authors: string[];
  summary: string;
  coverUrl: string | null;
  language: string | null; // dc:language (spec F-1)
  categories: string[]; // category/subject terms (spec F-2)
  mediaType: MediaType; // derived from acquisition-link MIME (spec F-3)
  rightsText: string | null; // license/rights as provided (spec P0-7)
  mature: boolean | null; // feed maturity flag where present (spec D8/F-4)
  links: AcquisitionLink[];
  canonicalUrl: string | null;
}

export interface FeedSource {
  id: string; // local uuid
  url: string; // https feed URL
  title: string | null; // feed title from parse
  addedAt: string; // ISO 8601
  lastRefreshedAt: string | null;
  isStarter: boolean; // from the owner-curated starter list (spec P0-5)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/errors.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/types.ts mobile/src/openshelves/errors.ts mobile/src/openshelves/__tests__/errors.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(open-shelves): feed schema + typed errors + fast-xml-parser dep"
```

---

### Task 2: Plaintext normalization + media-type mapping

**Files:**
- Create: `mobile/src/openshelves/normalize.ts`
- Test: `mobile/src/openshelves/__tests__/normalize.test.ts`

**Interfaces:**
- Consumes: `MediaType` from `./types`, `MAX_FIELD_LEN` (defined here, re-exported).
- Produces:
  - `const MAX_FIELD_LEN = 4096`
  - `toPlainText(raw: string | null | undefined): string` — decode entities, strip tags, collapse whitespace, clamp to `MAX_FIELD_LEN`. Returns `""` for nullish.
  - `mediaTypeFromMime(mime: string | null | undefined): MediaType` — `application/epub+zip`/`application/pdf`/`.../x-mobipocket-ebook` → `book`; `audio/*` → `audio`; `video/*` → `video`; else `other`.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/normalize.test.ts
import { toPlainText, mediaTypeFromMime, MAX_FIELD_LEN } from "../normalize";

test("strips tags and decodes entities to inert plaintext", () => {
  expect(toPlainText("<b>Moby&nbsp;Dick</b>")).toBe("Moby Dick");
  expect(toPlainText("Tom &amp; Jerry")).toBe("Tom & Jerry");
  expect(toPlainText("caf&#233;")).toBe("café");
});

test("hostile markup renders inert (no tag survives)", () => {
  const out = toPlainText('<img src=x onerror="alert(1)"><script>alert(2)</script>hi');
  expect(out).not.toMatch(/[<>]/);
  expect(out).not.toMatch(/onerror|script/i);
  expect(out).toContain("hi");
});

test("collapses whitespace and clamps to MAX_FIELD_LEN", () => {
  expect(toPlainText("a\n\n   b\t c")).toBe("a b c");
  expect(toPlainText("x".repeat(MAX_FIELD_LEN + 500)).length).toBe(MAX_FIELD_LEN);
});

test("nullish → empty string", () => {
  expect(toPlainText(null)).toBe("");
  expect(toPlainText(undefined)).toBe("");
});

test("media type maps from MIME", () => {
  expect(mediaTypeFromMime("application/epub+zip")).toBe("book");
  expect(mediaTypeFromMime("application/pdf")).toBe("book");
  expect(mediaTypeFromMime("audio/mpeg")).toBe("audio");
  expect(mediaTypeFromMime("video/mp4")).toBe("video");
  expect(mediaTypeFromMime("application/octet-stream")).toBe("other");
  expect(mediaTypeFromMime(null)).toBe("other");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/normalize.test.ts`
Expected: FAIL — cannot find module `../normalize`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/normalize.ts
// Plaintext normalization for untrusted feed strings (spec §7). This is
// normalization, NOT an HTML sanitizer: it decodes entities and strips ALL tags
// so the result is inert text safe to render in an RN <Text>. HTML *rendering*
// on web (a later UI plan) reuses sanitizeFragment (reader/sanitize.ts, web-only).
import type { MediaType } from "./types";

export const MAX_FIELD_LEN = 4096;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m));
}

export function toPlainText(raw: string | null | undefined): string {
  if (raw == null) return "";
  const noTags = String(raw).replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(noTags);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_FIELD_LEN ? collapsed.slice(0, MAX_FIELD_LEN) : collapsed;
}

export function mediaTypeFromMime(mime: string | null | undefined): MediaType {
  const m = (mime ?? "").toLowerCase();
  if (
    m === "application/epub+zip" ||
    m === "application/pdf" ||
    m === "application/x-mobipocket-ebook"
  )
    return "book";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/normalize.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/normalize.ts mobile/src/openshelves/__tests__/normalize.test.ts
git commit -m "feat(open-shelves): plaintext normalization + media-type mapping"
```

---

### Task 3: Hardened OPDS 1.2 parser (the attack surface)

**Files:**
- Create: `mobile/src/openshelves/opds12.ts`
- Test: `mobile/src/openshelves/__tests__/opds12.test.ts`

**Interfaces:**
- Consumes: `FeedEntry`, `AcquisitionLink` from `./types`; `FeedParseError` from `./errors`; `toPlainText`, `mediaTypeFromMime` from `./normalize`.
- Produces:
  - `const MAX_ENTRIES = 5000`
  - `parseOpds12(xml: string): { feedTitle: string | null; entries: FeedEntry[] }` — parse an OPDS 1.2 (Atom) document. Throws `FeedParseError` on malformed XML or a document with no Atom `<feed>` root. Never expands entities. Caps entries at `MAX_ENTRIES`.

**Notes for the implementer:**
- Configure `fast-xml-parser`'s `XMLParser` with `{ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false, isArray: (name) => name === "entry" || name === "link" || name === "author" || name === "category" }`. `processEntities: false` is the XXE guarantee — assert it in a test with a `<!DOCTYPE>`/`<!ENTITY>` payload.
- Atom fields: entry `id`, `title`, `author>name`, `summary`/`content`, `dc:language` (also seen as `dcterms:language`), `category` (`@_term`/`@_label`), `link` (`@_href`, `@_type`, `@_rel`). Cover = a `link` with `rel` containing `image` (`http://opds-spec.org/image` or `.../thumbnail`). Rights = `rights` or `dcterms:rights`. Maturity flag = presence of a scheme/term indicating mature content is rare; set `mature` from a `category` whose `@_scheme` or `@_term` matches `/mature|adult|explicit/i`, else `null`.
- An entry with no `id` is skipped (can't reconcile). Missing optional fields → `null`/`[]`, never invented (spec P0-7).
- Wrap the parser call in try/catch → `FeedParseError`. If the parsed object has no `feed`, throw `FeedParseError` naming OPDS + the support email.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/opds12.test.ts
import { parseOpds12, MAX_ENTRIES } from "../opds12";
import { FeedParseError } from "../errors";

const OPDS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Test Library</title>
  <entry>
    <id>urn:x:1</id>
    <title>Moby&#32;Dick</title>
    <author><name>Herman Melville</name></author>
    <summary>A whale &amp; a man.</summary>
    <dc:language>en</dc:language>
    <category term="Fiction" label="Fiction"/>
    <link rel="http://opds-spec.org/image" href="https://ex.org/c.jpg" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition/open-access" href="https://ex.org/m.epub" type="application/epub+zip"/>
    <link rel="alternate" href="https://ex.org/moby"/>
  </entry>
  <entry>
    <title>No Id — skipped</title>
  </entry>
</feed>`;

test("parses OPDS 1.2 entries with normalized fields", () => {
  const { feedTitle, entries } = parseOpds12(OPDS);
  expect(feedTitle).toBe("Test Library");
  expect(entries).toHaveLength(1); // the id-less entry is skipped
  const e = entries[0];
  expect(e.id).toBe("urn:x:1");
  expect(e.title).toBe("Moby Dick");
  expect(e.authors).toEqual(["Herman Melville"]);
  expect(e.summary).toBe("A whale & a man.");
  expect(e.language).toBe("en");
  expect(e.categories).toEqual(["Fiction"]);
  expect(e.coverUrl).toBe("https://ex.org/c.jpg");
  expect(e.mediaType).toBe("book");
  expect(e.canonicalUrl).toBe("https://ex.org/moby");
  expect(e.links.some((l) => l.mimeType === "application/epub+zip")).toBe(true);
  expect(e.mature).toBeNull();
});

test("malformed XML throws FeedParseError", () => {
  expect(() => parseOpds12("<feed><entry><id>x</id")).toThrow(FeedParseError);
});

test("a non-Atom document throws FeedParseError naming OPDS", () => {
  expect(() => parseOpds12('<rss version="2.0"><channel/></rss>')).toThrow(/OPDS/);
});

test("XXE: entities are not expanded", () => {
  const xxe = `<?xml version="1.0"?>
  <!DOCTYPE feed [ <!ENTITY xxe "PWNED"> ]>
  <feed xmlns="http://www.w3.org/2005/Atom"><title>&xxe;</title>
    <entry><id>1</id><title>&xxe;</title></entry></feed>`;
  const { entries } = parseOpds12(xxe);
  // The entity must NOT resolve to "PWNED".
  expect(JSON.stringify(entries)).not.toContain("PWNED");
});

test("mature flag detected from a category scheme/term", () => {
  const m = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <id>m1</id><title>x</title><category term="mature"/></entry></feed>`;
  expect(parseOpds12(m).entries[0].mature).toBe(true);
});

test("entry count is capped at MAX_ENTRIES", () => {
  const many =
    `<feed xmlns="http://www.w3.org/2005/Atom">` +
    Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => `<entry><id>e${i}</id><title>t</title></entry>`).join("") +
    `</feed>`;
  expect(parseOpds12(many).entries.length).toBe(MAX_ENTRIES);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/opds12.test.ts`
Expected: FAIL — cannot find module `../opds12`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/opds12.ts
// OPDS 1.2 (Atom) parser — THE attack surface (spec §7). fast-xml-parser is pure
// JS with NO external-entity resolution; `processEntities: false` disables even
// internal entity expansion, closing XXE by construction. Output fields are
// plaintext-normalized; nothing is fetched, nothing is executed.
import { XMLParser } from "fast-xml-parser";
import type { AcquisitionLink, FeedEntry } from "./types";
import { FeedParseError } from "./errors";
import { mediaTypeFromMime, toPlainText } from "./normalize";

export const MAX_ENTRIES = 5000;
const SUPPORT = "support_mentible@mambakkam.net";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false, // XXE guarantee — never expand entities
  isArray: (name) =>
    name === "entry" || name === "link" || name === "author" || name === "category",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: any): string {
  // fast-xml-parser puts element text under #text when attributes exist, else the value itself.
  if (v == null) return "";
  if (typeof v === "object") return toPlainText(v["#text"] ?? "");
  return toPlainText(String(v));
}

function firstLangKey(entry: any): string | null {
  const v = entry["dc:language"] ?? entry["dcterms:language"] ?? entry["language"];
  const t = text(v);
  return t || null;
}

function parseLinks(entry: any): { links: AcquisitionLink[]; cover: string | null; canonical: string | null } {
  const links: AcquisitionLink[] = [];
  let cover: string | null = null;
  let canonical: string | null = null;
  for (const l of asArray<any>(entry.link)) {
    const href = String(l["@_href"] ?? "");
    const rel = String(l["@_rel"] ?? "");
    const type = String(l["@_type"] ?? "");
    if (!href) continue;
    if (/image|thumbnail/i.test(rel)) {
      if (!cover) cover = href;
      continue;
    }
    if (rel === "alternate" || rel === "self") {
      if (!canonical) canonical = href;
    }
    if (/acquisition|open-access/i.test(rel) || /epub|pdf|audio|video|mobi/i.test(type)) {
      links.push({ href, mimeType: type, rel });
    }
  }
  return { links, cover, canonical };
}

function isMature(entry: any): boolean | null {
  for (const c of asArray<any>(entry.category)) {
    const term = String(c["@_term"] ?? "");
    const scheme = String(c["@_scheme"] ?? "");
    if (/mature|adult|explicit/i.test(term) || /mature|adult|explicit/i.test(scheme)) return true;
  }
  return null;
}

function toEntry(raw: any): FeedEntry | null {
  const id = text(raw.id);
  if (!id) return null; // no stable key → cannot reconcile (spec P0-4)
  const authors = asArray<any>(raw.author)
    .map((a) => text(a?.name))
    .filter((n) => n.length > 0);
  const categories = asArray<any>(raw.category)
    .map((c) => toPlainText(String(c["@_label"] ?? c["@_term"] ?? "")))
    .filter((t) => t.length > 0);
  const { links, cover, canonical } = parseLinks(raw);
  const primaryMime = links.find((l) => mediaTypeFromMime(l.mimeType) !== "other")?.mimeType ?? null;
  return {
    id,
    title: text(raw.title),
    authors,
    summary: text(raw.summary) || text(raw.content),
    coverUrl: cover,
    language: firstLangKey(raw),
    categories,
    mediaType: mediaTypeFromMime(primaryMime),
    rightsText: text(raw.rights) || text(raw["dcterms:rights"]) || null,
    mature: isMature(raw),
    links,
    canonicalUrl: canonical,
  };
}

export function parseOpds12(xml: string): { feedTitle: string | null; entries: FeedEntry[] } {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new FeedParseError(`could not parse feed XML: ${(err as Error).message}`);
  }
  const feed = doc?.feed;
  if (!feed || typeof feed !== "object") {
    throw new FeedParseError(
      `not an OPDS feed. Only OPDS catalogs are supported — email ${SUPPORT} to request another format.`,
    );
  }
  const feedTitle = text(feed.title) || null;
  const rawEntries = asArray<any>(feed.entry).slice(0, MAX_ENTRIES);
  const entries: FeedEntry[] = [];
  for (const r of rawEntries) {
    const e = toEntry(r);
    if (e) entries.push(e);
  }
  return { feedTitle, entries };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/opds12.test.ts`
Expected: PASS — 6 passed. If the XXE test fails (entity resolved), STOP — `processEntities` is misconfigured; do not work around it.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/opds12.ts mobile/src/openshelves/__tests__/opds12.test.ts
git commit -m "feat(open-shelves): hardened OPDS 1.2 parser (XXE-off, caps, normalized)"
```

---

### Task 4: Feed URL validation + fetch seam

**Files:**
- Create: `mobile/src/openshelves/fetchFeed.ts`
- Test: `mobile/src/openshelves/__tests__/fetchFeed.test.ts`

**Interfaces:**
- Consumes: `FeedSourceError`, `FeedParseError` from `./errors`; `MAX_FEED_BYTES` (defined here).
- Produces:
  - `const MAX_FEED_BYTES = 8 * 1024 * 1024`
  - `validateFeedUrl(url: string): string` — trims; throws `FeedSourceError` unless it is a well-formed `https:` URL; returns the normalized URL.
  - `fetchFeed(url: string, fetchImpl?: typeof fetch): Promise<string>` — validates, GETs, maps `401`/`403` → `FeedSourceError({authRequired:true})`, other non-2xx → `FeedSourceError`, oversized body → `FeedParseError`, returns the raw text. `fetchImpl` defaults to global `fetch` (injectable for tests — no live network).

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/fetchFeed.test.ts
import { validateFeedUrl, fetchFeed, MAX_FEED_BYTES } from "../fetchFeed";
import { FeedSourceError, FeedParseError } from "../errors";

function res(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (k: string) => (init.headers ?? {})[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

test("validateFeedUrl accepts https, rejects http and junk", () => {
  expect(validateFeedUrl("  https://ex.org/f.atom ")).toBe("https://ex.org/f.atom");
  expect(() => validateFeedUrl("http://ex.org/f")).toThrow(FeedSourceError);
  expect(() => validateFeedUrl("not a url")).toThrow(FeedSourceError);
});

test("fetchFeed returns body on 200", async () => {
  const fake = async () => res("<feed/>");
  await expect(fetchFeed("https://ex.org/f", fake as any)).resolves.toBe("<feed/>");
});

test("401/403 → FeedSourceError authRequired", async () => {
  const fake = async () => res("", { status: 401 });
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toMatchObject({
    name: "FeedSourceError",
    authRequired: true,
  });
});

test("other non-2xx → FeedSourceError (not authRequired)", async () => {
  const fake = async () => res("", { status: 500 });
  const err = await fetchFeed("https://ex.org/f", fake as any).catch((e) => e);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect(err.authRequired).toBeUndefined();
});

test("oversized body (content-length) → FeedParseError", async () => {
  const fake = async () => res("x", { headers: { "content-length": String(MAX_FEED_BYTES + 1) } });
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toBeInstanceOf(FeedParseError);
});

test("oversized body (no content-length, long text) → FeedParseError", async () => {
  const fake = async () => res("x".repeat(MAX_FEED_BYTES + 1));
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toBeInstanceOf(FeedParseError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/fetchFeed.test.ts`
Expected: FAIL — cannot find module `../fetchFeed`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/fetchFeed.ts
// The network seam: validate an https feed URL and fetch its raw text under caps,
// with the no-auth guardrail (spec P0-8/P0-9). No auth is ever sent; content is
// never stored. `fetchImpl` is injectable so tests never touch the network.
import { FeedParseError, FeedSourceError } from "./errors";

export const MAX_FEED_BYTES = 8 * 1024 * 1024;

export function validateFeedUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FeedSourceError("That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new FeedSourceError("Feed URLs must use https.");
  }
  return trimmed;
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clean = validateFeedUrl(url);
  let resp: Response;
  try {
    resp = await fetchImpl(clean, { method: "GET" });
  } catch (err) {
    throw new FeedSourceError(`Could not reach the feed: ${(err as Error).message}`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new FeedSourceError("Authenticated repos aren't supported yet.", { authRequired: true });
  }
  if (!resp.ok) {
    throw new FeedSourceError(`The feed responded with an error (HTTP ${resp.status}).`);
  }
  const declared = resp.headers.get("content-length");
  if (declared && Number(declared) > MAX_FEED_BYTES) {
    throw new FeedParseError("That feed is too large to add.");
  }
  const body = await resp.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new FeedParseError("That feed is too large to add.");
  }
  return body;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/fetchFeed.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/fetchFeed.ts mobile/src/openshelves/__tests__/fetchFeed.test.ts
git commit -m "feat(open-shelves): https-only fetch seam + no-auth guardrail + size caps"
```

---

### Task 5: Idempotent reconcile (upsert + prune)

**Files:**
- Create: `mobile/src/openshelves/reconcile.ts`
- Test: `mobile/src/openshelves/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: `FeedEntry` from `./types`.
- Produces:
  - `interface ReconcileResult { merged: FeedEntry[]; added: number; updated: number; removed: number }`
  - `reconcileEntries(prev: FeedEntry[], incoming: FeedEntry[]): ReconcileResult` — key on `id`; entries in `incoming` upsert (added if new, updated if present and changed), entries in `prev` absent from `incoming` are pruned. `merged` preserves `incoming` order and contains no duplicate ids. Pure — no store, no side effects. This is the P0-4 refresh contract (partial-fetch handling is the caller's job: on a failed fetch it simply keeps `prev`).

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/reconcile.test.ts
import { reconcileEntries } from "../reconcile";
import type { FeedEntry } from "../types";

const mk = (id: string, title = "t"): FeedEntry => ({
  id, title, authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "book", rightsText: null, mature: null,
  links: [], canonicalUrl: null,
});

test("adds new entries", () => {
  const r = reconcileEntries([], [mk("a"), mk("b")]);
  expect(r.merged.map((e) => e.id)).toEqual(["a", "b"]);
  expect(r).toMatchObject({ added: 2, updated: 0, removed: 0 });
});

test("double refresh of the same feed produces no duplicates", () => {
  const feed = [mk("a"), mk("b")];
  const once = reconcileEntries([], feed);
  const twice = reconcileEntries(once.merged, feed);
  expect(twice.merged.map((e) => e.id)).toEqual(["a", "b"]);
  expect(twice).toMatchObject({ added: 0, updated: 0, removed: 0 });
});

test("prunes entries no longer in the feed", () => {
  const r = reconcileEntries([mk("a"), mk("b")], [mk("a")]);
  expect(r.merged.map((e) => e.id)).toEqual(["a"]);
  expect(r.removed).toBe(1);
});

test("updates changed entries, counts them", () => {
  const r = reconcileEntries([mk("a", "old")], [mk("a", "new")]);
  expect(r.merged[0].title).toBe("new");
  expect(r).toMatchObject({ added: 0, updated: 1, removed: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/reconcile.test.ts`
Expected: FAIL — cannot find module `../reconcile`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/reconcile.ts
// Idempotent refresh reconcile (spec P0-4): upsert incoming entries by Atom id,
// prune entries the feed no longer lists, never duplicate. Pure — the caller owns
// persistence and the "keep prev on failed fetch" partial-failure rule.
import type { FeedEntry } from "./types";

export interface ReconcileResult {
  merged: FeedEntry[];
  added: number;
  updated: number;
  removed: number;
}

export function reconcileEntries(prev: FeedEntry[], incoming: FeedEntry[]): ReconcileResult {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const incomingIds = new Set(incoming.map((e) => e.id));
  const merged: FeedEntry[] = [];
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const e of incoming) {
    if (seen.has(e.id)) continue; // guard against duplicate ids within one feed
    seen.add(e.id);
    const before = prevById.get(e.id);
    if (!before) added += 1;
    else if (JSON.stringify(before) !== JSON.stringify(e)) updated += 1;
    merged.push(e);
  }

  const removed = prev.reduce((n, e) => (incomingIds.has(e.id) ? n : n + 1), 0);
  return { merged, added, updated, removed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/reconcile.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Run the whole module's suite + typecheck**

Run: `cd mobile && npx jest src/openshelves && npx tsc --noEmit -p tsconfig.json`
Expected: all openshelves suites pass; tsc reports no new errors in `src/openshelves/`.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/reconcile.ts mobile/src/openshelves/__tests__/reconcile.test.ts
git commit -m "feat(open-shelves): idempotent reconcile (upsert + prune, no dupes)"
```

---

## What this plan deliberately leaves to later plans

The foundation above is UI-less, persistence-less, and network-mockable. Sequenced follow-on plans on `feat/open-shelves`:

1. **Store persistence** — a `feedStore` (P0-3) over the house storage layer (AsyncStorage today; expo-sqlite if 10k-entry feeds outgrow the quota — mirror `bookStore.ts`), wiring `reconcileEntries` into per-source refresh with the "keep prev on failed fetch" rule (P0-4).
2. **Sources management UI** (P0-1) — add/list/remove with the add-time warning (P0-8) and no-auth message (P0-9).
3. **Starter list** (P0-5) over remote-config; D3a live-feed verification.
4. **Refresh UI** (P0-4) — per-source + refresh-all, last-refreshed display.
5. **Browse + provenance** (P0-7) — entry list/detail rendering (web path reuses `sanitizeFragment` if any HTML is shown).
6. **Downloads + offline** (P0-6 / P0-10) — EPUB/PDF, device-local, per D2a rendering surface.
7. **Language filter F-1** (spec D9 recommendation) — a pure `(prefs × entry) → boolean` filter over the fields P0-3 already stores.

## Self-Review

**Spec coverage (this slice):** P0-2 seam (`validate`/`fetch_feed`/`parse_entries`) → Tasks 3+4; P0-3 schema fields → Task 1 `FeedEntry`; §7 hardened parser (XXE-off, caps, sanitized strings) → Tasks 2+3; P0-8 https + caps + inert markup → Tasks 2+4; P0-9 no-auth guardrail → Task 4; P0-4 idempotent upsert/prune → Task 5; typed errors (§7) → Task 1. UI/persistence/starter-list/downloads/filters are explicitly deferred above.

**Placeholder scan:** none — every step carries real code/commands. One inline correction is flagged in Task 3 Step 3 (the `|| null || null` typo, with the fix stated).

**Type consistency:** `FeedEntry`/`FeedSource`/`AcquisitionLink`/`MediaType` defined in Task 1 are consumed unchanged in Tasks 2/3/5; `FeedSourceError`/`FeedParseError` signatures match across Tasks 1/3/4; `parseOpds12`, `fetchFeed`, `reconcileEntries`, `toPlainText`, `mediaTypeFromMime` signatures are identical between their producing task and the interfaces block.
