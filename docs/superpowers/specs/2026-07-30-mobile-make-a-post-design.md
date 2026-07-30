# Mobile "Make a post" (Publish tab) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 D8 (the "Share" phase)** · second slice of the Short-Form Publishing Studio ([#338] proposal). Consumes the `POST /api/v1/derivatives/post` backend endpoint (PR #351, on `main`).
**Scope:** one mobile surface — a **Publish** tab — that turns **pasted source text** into **3 platform-scoped social post variants** (LinkedIn / X) via the derivatives endpoint, with copy-to-clipboard. Mobile only; **no backend change, no persistence, no library/version picker**.

## Why this shape (re-scoped from "Share seam")
The original intent was a "Make a post from a trust version" action (source = the version's content). Recon found that path is **blocked**: `VersionSummaryView` carries no content field, there is **no version-content read endpoint**, and version authoring is still an empty stub (`addVersion({text:""})`). So a version has no `source_text` to consume today. Rather than gate the mobile UI on two unbuilt backend pieces, this slice ships the **standalone paste** surface — unblocked, fully demoable — and leaves the version "Make a post ▸" shortcut as a thin follow-up for when version content + a read endpoint exist.

## Grounding — mirror existing mobile patterns (verified by recon)
- **HTTP client:** `src/api/client.ts` `apiFetch<T>(path, options)` (base URL from `EXPO_PUBLIC_API_BASE_URL`, JSON, throws `ApiError` on `!ok`; `ApiError.userMessage()` maps 429→friendly, else `{detail}`). The `/derivatives/post` client is **key-free in shape** like `submitGenerate` — the `api_key` is placed in the body by the caller (the hook), NOT read inside the client.
- **Key handling:** `src/secure/keyStore.ts` `loadApiKey(provider = "anthropic")` (expo-secure-store native / localStorage web). Every generate-family caller **requires** a key and always sends it — this slice does the same (**BYOK-only**; no managed omission).
- **Hook shape:** mirror `src/hooks/useGenerateTopic.ts` — `{status: "idle"|"generating"|"done"|"failed", error, run(args)}`, `getApiKey` → guard null → call client → map `ApiError`→`userMessage()`. **No `pollUntilDone`** — `/derivatives/post` is synchronous (returns variants in the response body, no `job_id`).
- **Nav/gating:** tab registration = `app/(tabs)/_layout.tsx` (`<Tabs.Screen>`) + `src/components/TopNavBar.tsx` (`TABS` map + `ORDER` array, with the `...(IS_DEMO ? [] : [...])` exclusion used for backend-only tabs) + `src/constants/labels.ts` (`NAV.*`). `IS_DEMO` from `src/constants/demo.ts`.
- **Alert:** `import { Alert } from "@/lib/alert"` (web-safe) — used only for the no-key nudge if needed; the primary error surface is inline text.
- **Help DoD gate:** add a `FEATURES` key in `src/help-content/features.ts` **and** a topic with that `featureKey` in `src/help-content/topics.ts`, same PR (`__tests__/help/coverage.test.ts` fails otherwise).
- **Tests:** RNTL, mock the **hook** (`jest.mock("@/hooks/useMakePost")`), expo-router mock, `@/lib/alert` mock; route imported directly as the default export (`import Publish from "@/../app/(tabs)/publish"`).

---

## New files

### `src/api/derivativesClient.ts`
```ts
export type Platform = "linkedin" | "x";

export interface MakePostRequest {
  source_text: string;
  platform: Platform;
  tone?: string;
  api_key: string;          // BYOK-only this slice — always sent
  provider_id?: string;     // default "anthropic" (omit → server default)
  model?: string;
}

export interface PostVariant {
  hook: string;
  body: string;
  hashtags: string[];
  cta?: string | null;
}

export interface MakePostResponse {
  platform: string;
  variants: PostVariant[];  // exactly 3 (server-enforced)
  provenance: string;       // "ai-generated"
}

// POST /api/v1/derivatives/post via apiFetch — key-free client shape (no JWT).
export async function makePost(req: MakePostRequest): Promise<MakePostResponse>;
```
- Mirrors `submitGenerate`: builds no key itself; the fully-populated `req` (with `api_key`) is passed in by the hook. Throws `ApiError` on non-2xx (the screen renders `.userMessage()`).

### `src/hooks/useMakePost.ts`
```ts
type Status = "idle" | "generating" | "done" | "failed";
interface RunArgs { sourceText: string; platform: Platform; tone?: string; }

useMakePost(): {
  status: Status;
  error: string | null;
  variants: PostVariant[];
  provenance: string | null;
  run: (args: RunArgs) => Promise<void>;
  reset: () => void;
}
```
- `run`: `const apiKey = await loadApiKey("anthropic")`; if null → `status="failed"`, `error="No API key saved. Add one in Settings to make a post."` (mirror `useGenerateTopic`'s guard copy). Else `await makePost({ source_text, platform, tone, api_key: apiKey, provider_id: "anthropic" })`; on success set variants+provenance, `status="done"`; on `ApiError` set `error = e.userMessage()`, `status="failed"`. Never store/log the key.
- **No polling.** Single awaited call.

### `src/lib/clipboard.ts`
```ts
export async function copyText(text: string): Promise<void>;
```
- Thin wrapper over `expo-clipboard` `setStringAsync` (new dep, `npx expo install expo-clipboard`; web-safe). Isolated so screen tests mock `@/lib/clipboard`, not the native module.

### `app/(tabs)/publish.tsx`
Single-screen flow inside the app's standard page container:
1. **Source** — a multiline `TextInput` (paste/type). "Generate" is disabled when trimmed-empty or `status==="generating"`.
2. **Platform** — a two-option segmented control `LinkedIn | X` (default `linkedin`). Optional **tone** single-line `TextInput` (placeholder e.g. "punchy, professional…").
3. **Generate** button → `run(...)`. While `generating`, show a spinner.
4. **Results** — for each of the 3 variants, a card: hook (emphasis) · body · hashtags (joined) · cta (if present) · a **Copy** button (`copyText(assemblePost(variant))`) with a brief "Copied" acknowledgement · and an **"AI-generated"** provenance tag rendered once above/below the cards.
5. **Error** — inline text = `error` (from `userMessage()` or the no-key guard).
- `assemblePost(v)` = `\`${v.hook}\n\n${v.body}\n\n${v.hashtags.join(" ")}${v.cta ? "\n\n" + v.cta : ""}\``.
- Accessibility labels on Generate, each Copy, and the platform toggle (tests select by label).

---

## Touched files
- `app/(tabs)/_layout.tsx` — add `<Tabs.Screen name="publish" .../>`.
- `src/components/TopNavBar.tsx` — `TABS.publish` (label + icon) + add `"publish"` to `ORDER` inside the `IS_DEMO ? [] : [...]` backend-only group (Publish needs a key/backend → excluded from demo).
- `src/constants/labels.ts` — `NAV.publish = "Publish"`.
- `src/help-content/features.ts` — `{ key: "make-a-post", label: "Make a post" }`.
- `src/help-content/topics.ts` — a topic `{ id, featureKey: "make-a-post", keywords, blocks:[{kind:"text", text}] }` explaining paste → platform → variants → copy, and that it needs a saved BYOK key.
- `package.json` — `expo-clipboard`.

## Testing
Screen (`__tests__/screens/Publish.test.tsx`, mock `useMakePost` + `@/lib/clipboard`):
- empty source → Generate disabled; typing enables it.
- `status:"done"` with 3 variants → 3 cards render + the "AI-generated" tag present.
- pressing a Copy button calls `copyText` with the assembled post for that variant.
- `status:"failed"` with an error → the error text is shown.
- no-key path: hook returns the no-key `error` → surfaced (covered via the failed-status case with that message).

Hook (`__tests__/hooks/useMakePost.test.ts`, mock `@/api/derivativesClient` + `@/secure/keyStore`):
- key present → `makePost` called with `api_key` populated + `provider_id:"anthropic"`, `status` → `done`, variants set.
- `loadApiKey` returns null → `makePost` NOT called, `status:"failed"`, no-key error.
- `makePost` throws `ApiError` → `error === userMessage()`, `status:"failed"`.

Client (`__tests__/api/derivativesClient.test.ts`): `makePost` POSTs to `/derivatives/post` with the exact body; non-2xx → `ApiError`.

**Coverage gate:** the new `make-a-post` FEATURES key + its topic land together (CI `coverage.test.ts`).

## Out of scope (later slices)
- Managed-key path (omit `api_key`) + a use-my-key-vs-managed toggle.
- Source from the library (books/lessons/authored diagrams) or a trust version (the "Make a post ▸" shortcut) — both need a content source this slice doesn't build.
- Banner / carousel / animated / audio formats.
- Saving posts, brand kit, direct-publish, reference inputs.
- Provider selection UI (fixed to anthropic + the saved anthropic key this slice).

## Open items (resolve in the plan, non-blocking)
1. Segmented control: use an existing component if one exists in `src/components/`, else two `Pressable`s styled as a toggle.
2. "Copied" acknowledgement: transient inline label vs the alert shim — plan picks the lighter one (inline).
3. Whether to expose `provider_id`/`model` at all this slice — spec fixes anthropic; no UI.
