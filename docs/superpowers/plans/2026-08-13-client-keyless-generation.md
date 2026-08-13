# Client keyless (managed) generation for Pro users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro (managed-eligible) user generate in the trust workspace with no saved BYOK key — the client sends a keyless (managed) request instead of throwing "No API key saved".

**Architecture:** Make `api_key` optional through the submit chain (`trustClient` 3 fns → 3 job runners), then in `useTrustProject`'s 4 generators decide: saved key ⇒ BYOK; no key + Pro ⇒ keyless (omit `api_key`); no key + not-Pro ⇒ the existing add-a-key message. Pro-ness comes from `useBillingPlan().plan.is_pro`.

**Tech Stack:** React Native (Expo), TypeScript; Jest + RNTL. Mobile-only (no backend/migration).

## Global Constraints

- Never send `api_key: ""` — **omit** the field when there's no key (backend `min_length=20` rejects a short string; `None`/absent is the managed signal). `JSON.stringify` drops an `undefined` property, so pass `apiKey: key ?? undefined`.
- Fail-open: a `null` plan must NOT break BYOK — `isPro` is only read on the no-key branch (`!key && !isPro`). Free/`null` + no key ⇒ the message; any + key ⇒ BYOK unchanged.
- No color-literal asserts; `Alert` from `@/lib/alert`. Mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** backend `DraftGenerateIn.api_key: str | None = None` (min_length only when present) — same for topic-generate + suggest-TOC schemas; keyless works by omitting the field. `trustClient` submit fns: `generateVersion(artifactId, {api_key: string; provider_id?; model?; guidance?}, token)`, `suggestToc(projectId, {api_key: string; provider_id?}, token)`, `generateTopic(projectId, topicId, {api_key: string; provider_id?; model?; guidance?}, token)` — all in `mobile/src/api/trustClient.ts`. Runners: `RunGenerateVersionArgs.apiKey: string` (`useGenerateVersionJob.ts`), `RunSuggestTocArgs.apiKey: string` (`useSuggestTocJob.ts`), `RunGenerateTopicArgs.apiKey: string` (`useGenerateTopicJob.ts`); each sends `{ api_key: args.apiKey, ... }`. `useBillingPlan(): { plan: PlanStatus | null; loading }`, `PlanStatus.is_pro: boolean` (`mobile/src/api/billingClient.ts`). `useTrustProject.ts` generators: `generateVersion` L82, `generateFormat` L90, `suggestToc` L107, `generateTopic` L151; imports `loadApiKey` from `@/secure/keyStore`. Existing hook tests: `mobile/__tests__/hooks/useTrustProject.{test,generateFormat,generateTopic,owner}.tsx`.

---

### Task 1: Make `api_key` optional through the submit chain

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (3 submit fns), `mobile/src/hooks/useGenerateVersionJob.ts`, `mobile/src/hooks/useSuggestTocJob.ts`, `mobile/src/hooks/useGenerateTopicJob.ts`
- Test: `mobile/__tests__/api/trustClient.test.ts` (extend if present, else add) — or a runner test asserting the omitted body

**Interfaces:**
- Produces: `trustClient.generateVersion/suggestToc/generateTopic` accept `api_key?: string`; the 3 runners accept `apiKey?: string`. When `apiKey` is `undefined`, the POST body omits `api_key`.

- [ ] **Step 1: Write the failing test.** In `mobile/__tests__/api/trustClient.test.ts` (create if absent — mirror `adminClient.test.ts`'s fetch-mock style), assert: `suggestToc("p1", { provider_id: "anthropic" }, "tok")` (no `api_key`) issues a POST whose `JSON.parse(body)` has **no** `api_key` property; and `suggestToc("p1", { api_key: "sk-ant-"+"x".repeat(20), provider_id:"anthropic" }, "tok")` includes it. (One fn is enough — the three share the pattern.)

- [ ] **Step 2: Run it — FAIL** (type error: `api_key` required, or the assertion).

- [ ] **Step 3: Relax the types.** In `trustClient.ts`, change each of the 3 submit fns' body type `api_key: string` → `api_key?: string`. No other change — `JSON.stringify(body)` already drops an absent/`undefined` `api_key`.

- [ ] **Step 4: Relax the runners.** In `useGenerateVersionJob.ts`, `useSuggestTocJob.ts`, `useGenerateTopicJob.ts`: change `apiKey: string` → `apiKey?: string` in the `Run*Args` interface. The existing `{ api_key: args.apiKey, ... }` pass-through is unchanged (an `undefined` `args.apiKey` ⇒ dropped by `JSON.stringify`).

- [ ] **Step 5: Run** — `cd mobile && npx jest trustClient && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useGenerateVersionJob.ts mobile/src/hooks/useSuggestTocJob.ts mobile/src/hooks/useGenerateTopicJob.ts mobile/__tests__/api/trustClient.test.ts
git commit -m "refactor(trust): make api_key optional through the generation submit chain

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Keyless-when-Pro in `useTrustProject`'s 4 generators

**Files:**
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/hooks/useTrustProject.test.tsx` (+ keep `generateFormat`/`generateTopic`/`owner` variants green — they now render a hook that calls `useBillingPlan`, so they must mock it)

**Interfaces:**
- Consumes: `useBillingPlan` (`@/hooks/useBillingPlan`), `loadApiKey`, the 3 runners (now `apiKey?`).

- [ ] **Step 1: Write the failing test** in `mobile/__tests__/hooks/useTrustProject.test.tsx`. Mock `@/secure/keyStore` `loadApiKey`, `@/hooks/useBillingPlan`, and the job-runner hooks (`useGenerateVersionJob`/`useSuggestTocJob`/`useGenerateTopicJob` → each returns a `run` jest.fn resolving a minimal result). Cases (cover `suggestToc` + `generateTopic`):
  - `loadApiKey` → `null`, `useBillingPlan` → `{ plan: { is_pro: true, … }, loading:false }`: calling `suggestToc()` **resolves** and the suggest runner is called with `apiKey: undefined` (assert `runSuggest.mock.calls[0][0].apiKey` is `undefined`). Does NOT throw.
  - `loadApiKey` → `null`, `useBillingPlan` → `{ plan: { is_pro:false, … }, loading:false }`: `suggestToc()` **rejects** with a message containing "No API key saved". Same for `plan: null`.
  - `loadApiKey` → `"sk-ant-"+"x".repeat(20)`, any plan: `generateTopic(id)` calls the topic runner with `apiKey: "<key>"` (BYOK).
  (Build the `PlanStatus` mock with all its fields, or cast a partial — match how other tests mock it. No color-literal asserts.)

- [ ] **Step 2: Run it — FAIL** (the hook still throws on no-key regardless of Pro).

- [ ] **Step 3: Wire `useBillingPlan` into the hook.** In `useTrustProject.ts`, add `import { useBillingPlan } from "@/hooks/useBillingPlan";`, and near the top of the hook body: `const { plan } = useBillingPlan();` `const isPro = plan?.is_pro === true;`.

- [ ] **Step 4: Update the 4 generators.** For each of `generateVersion` (L82), `generateFormat` (L90), `suggestToc` (L107), `generateTopic` (L151):
  - change `if (!key) throw new Error("No API key saved. …")` → `if (!key && !isPro) throw new Error("No API key saved. …")` (keep each generator's existing verb wording).
  - change the runner call's `apiKey: key` → `apiKey: key ?? undefined`.
  - add `isPro` to that `useCallback`'s dependency array.
  Example (`suggestToc`):
```ts
  const suggestToc = useCallback(async (opts?): Promise<StructuredTocView> => {
    const key = await loadApiKey("anthropic");
    if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to suggest an outline.");
    if (!accessToken) throw new Error("Not signed in");
    return runSuggestTocJob({ projectId, apiKey: key ?? undefined, accessToken, onPhase: opts?.onPhase });
  }, [accessToken, projectId, runSuggestTocJob, isPro]);
```

- [ ] **Step 5: Make the existing hook tests mock `useBillingPlan`.** In `useTrustProject.{generateFormat,generateTopic,owner}.test.tsx` (and the base `test.tsx`), add a `jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: false }, loading: false }) }))` (or return a key-present setup so BYOK path holds). Those tests use a saved key ⇒ BYOK ⇒ unaffected by `isPro`, but the hook now calls `useBillingPlan`, so it must be mocked to avoid a real fetch.

- [ ] **Step 6: Run** — `cd mobile && npx jest useTrustProject && npx tsc --noEmit && npx eslint .`. Then full `npx jest` to catch any other consumer.

- [ ] **Step 7: Commit**
```bash
git add mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks
git commit -m "feat(trust): keyless (managed) generation for Pro users with no saved BYOK key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — all green.
- [ ] No `api_key: ""` ever sent (omit when absent). BYOK unchanged when a key is saved. Free/`null`-plan + no key → the add-a-key message. Pro + no key → keyless.
- [ ] **Deploy:** web deploy (`scripts/deploy/web-deploy.sh app`) + APK. No backend, no migration.

## Out of scope

- Backend changes (already keyless-capable). The Books surface hooks (`useMakePost`, `useGenerateChapterQuiz`, `useGenerateAll`, `useGenerateTopic`). Upgrade-nudge copy for Free users. The single-lesson `/generate` path.
