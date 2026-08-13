# Client keyless (managed) generation for Pro users — Design

**Status:** Approved (brainstorming, 2026-08-13).

**Context.** The tester full-access feature (#432) made the **backend** keyless-capable (trust generators
honor entitlements → generate on our managed Anthropic key when `api_key` is omitted) and added the console
grant. But the **mobile client still forces BYOK**: `useTrustProject.ts`'s 4 generators call
`loadApiKey("anthropic")` and **throw** "No API key saved. Add an Anthropic key in Settings…" when none is
stored — they never send the keyless request. So a granted Pro/managed tester with no BYOK key is blocked
at the UI (observed: the "Couldn't suggest — No API key saved" alert on Suggest-TOC).

This closes that gap: when no BYOK key is saved **and the user is Pro**, send a keyless (managed) request
instead of throwing.

## Decision (from brainstorming)

- **Free (not-Pro) user, no saved key:** unchanged — keep the "Add an Anthropic key in Settings" message.
- **Pro user, no saved key:** keyless (managed) — omit `api_key` (backend `managed = body.api_key is None`).
- **Any user with a saved key:** BYOK as today (the power-user path wins; a saved key means intent to BYOK).

## Confirmed facts

- Backend submit schemas already accept a missing key: `DraftGenerateIn.api_key: str | None = None`
  (`min_length=20` **only when present**) — so the client must **omit** the field, never send `""`.
  Same for the topic-generate and suggest-TOC submit schemas.
- `useBillingPlan(): { plan: PlanStatus | null; loading }`; `PlanStatus.is_pro: boolean`
  (`mobile/src/api/billingClient.ts`). Fail-open: `plan == null` ⇒ treat as not-Pro for the message (but
  see below — a null plan should still allow BYOK; it only affects the no-key branch).
- `useTrustProject.ts` imports `loadApiKey` (`@/secure/keyStore`) + `useAuth`. The 4 generators:
  `generateVersion` (L82), `generateFormat` (L90), `suggestToc` (L107), `generateTopic` (L151) — the first
  two go through `useGenerateVersionJob`, then `useSuggestTocJob`, `useGenerateTopicJob`.
- Job runners take `apiKey: string` (required) and send `{ api_key: args.apiKey, … }`; `trustClient`
  submit fns type the body `{ api_key: string; … }`.

## Architecture

### Make `api_key` optional through the submit chain

- **`mobile/src/api/trustClient.ts`** — 3 submit fns (`generateVersion`, `suggestToc`, `generateTopic`):
  body type `api_key: string` → `api_key?: string`. The body object is `JSON.stringify`-ed; an
  `undefined` `api_key` is dropped by `JSON.stringify` → the request omits it → backend managed path. (No
  code change needed beyond the type if callers pass `undefined`; never pass `""`.)
- **3 job runners** (`useGenerateVersionJob`, `useSuggestTocJob`, `useGenerateTopicJob`): args
  `apiKey: string` → `apiKey?: string`, passed straight through to the submit body as `api_key:
  args.apiKey` (undefined ⇒ dropped).

### Decide keyless vs BYOK vs message in `useTrustProject.ts`

- Add `const { plan } = useBillingPlan();` and `const isPro = plan?.is_pro === true;`.
- Replace each generator's guard:
  ```ts
  const key = await loadApiKey("anthropic");
  if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to <verb>.");
  if (!accessToken) throw new Error("Not signed in");
  // … run({ apiKey: key ?? undefined, … })  // undefined ⇒ managed/keyless
  ```
  (Keep each generator's existing verb in the message: "generate a draft" / "suggest an outline" /
  "generate".) A saved key ⇒ BYOK (unchanged); no key + Pro ⇒ keyless; no key + not-Pro ⇒ the message.

## Testing

- **Client (trustClient) / runner:** submitting with `apiKey` omitted produces a request body **without**
  `api_key` (assert the fetch body JSON has no `api_key` key); with a key present it includes it.
- **`useTrustProject` (RNTL hook test):** mock `loadApiKey`, `useBillingPlan`, the job runners.
  - no key + `is_pro:true` → the runner is called with `apiKey: undefined` (keyless), does NOT throw.
  - no key + not Pro (`plan:{is_pro:false}` and `plan:null`) → throws the "No API key saved…" message.
  - key present → runner called with `apiKey: "<key>"` (BYOK), regardless of Pro.
  Cover at least `suggestToc` (the observed failure) + one generate path (`generateTopic` or
  `generateVersion`); the four share the same guard shape.

## Rollout

**Web deploy + APK** (mobile-only change; no backend, no migration). After deploy, a granted Pro user
generates in the trust workspace with no saved key → runs on the managed key.

## Out of scope

- Any backend change (already keyless-capable). The `/generate` single-lesson path (already managed-aware).
  Upgrade-nudge copy for Free users (decided against — keep the add-a-key message). Post/quiz/generate-all
  hooks (`useMakePost`, `useGenerateChapterQuiz`, `useGenerateAll`, `useGenerateTopic`) — those are the
  Books surface, not the trust workspace; out of scope for this pass.

## Global constraints

- Never send `api_key: ""` — omit the field (backend `min_length=20` rejects a short string; `None` is the
  managed signal). Fail-open: a `null` plan must not break BYOK (only the no-key branch reads `isPro`).
- No color-literal asserts; `Alert` from `@/lib/alert`. Mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
