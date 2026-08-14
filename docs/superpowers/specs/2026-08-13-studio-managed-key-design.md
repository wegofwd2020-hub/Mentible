# Studio managed ("system API key") generation — Design

**Status:** Approved (brainstorming, 2026-08-13).

## Problem

We extended the managed / "system API key" path (Pro users generate on our managed Anthropic key, no
BYOK) to the trust workspace (#432/#433). The **Studio** (Books) surface was left BYOK-only: all its
generators throw *"No API key saved. Go to Settings and paste your Anthropic key."* when no key is stored.
Extend the same keyless-when-Pro path to Studio, at full parity with trust.

## Scope (decided: all Studio generators)

Four Studio generation hooks, two backend situations:
- **`useGenerateTopic`, `useGenerateAll`, `useGenerateChapterQuiz`** → all call `submitGenerate` →
  **`/generate`**, which **already** honors managed (`managed = body.api_key is None` →
  `resolve_managed_access` + `over_cap`, `generate/router.py:117-152`). **Client-only** change.
- **`useMakePost`** → **`/derivatives/post`**, whose managed gate is the **old `is_managed_eligible`
  (allowlist-only)** — explicitly documented there as a "slice 1... follow-up" (`derivatives/router.py:61-77`).
  A console-entitlement Pro user is refused. **Client + backend** change (this is that follow-up).

## Decisions (mirror the trust keyless work, #433 + ffbc056)

- **Keyless when Pro:** a generator with **no BYOK key** and a **Pro** account sends the request with
  `api_key` **omitted** (→ backend managed path). A saved key ⇒ BYOK (unchanged).
- **Fail-open:** only show the "add a key" message when the user is **known not-Pro**
  (`plan != null && plan.is_pro === false`); while the plan is loading (`plan == null`) a no-key request
  goes keyless and the backend decides. Matches the other `useBillingPlan` consumers.
- **Never send `api_key: ""`** — omit the field (backend `min_length`/`None`-is-managed).

## Architecture

### Backend — `/derivatives/post` honors entitlements (mirror `/generate`)

`backend/src/derivatives/router.py` `make_post`:
- Add `request: Request` to the handler signature (to reach the DB pool), plus imports `from
  backend.src.accounts import repo as accounts_repo` and `from backend.src.billing import access` (and
  `Request` from fastapi).
- Replace the `is_managed_eligible`-only block with the `/generate` DB-managed pattern:
  ```python
  managed = body.api_key is None
  if managed:
      db_pool = getattr(request.app.state, "db", None)
      if db_pool is not None and principal is not None:
          async with db_pool.acquire() as conn:
              account = await accounts_repo.get_or_create_account(
                  conn, idp_sub=principal.sub, email=principal.email)
              grant = await access.resolve_managed_access(
                  conn, account_id=account.id, provider_id=body.provider_id, principal=principal)
              if grant is None:
                  raise HTTPException(400, "an api_key is required for this request")
              if await access.over_cap(conn, account_id=account.id, access=grant):
                  raise HTTPException(429, "managed allowance exhausted; try again later or add your own key")
      elif not is_managed_eligible(principal, body.provider_id):
          raise HTTPException(400, "an api_key is required for this request")
      api_key = get_managed_key(body.provider_id)
  else:
      api_key = body.api_key
  ```
- Keep `get_managed_key`/BYOK selection + the "never log the key" discipline unchanged. Metering
  (`record_usage`) stays deferred for derivatives (the endpoint never metered; out of scope — parity is on
  *eligibility*, not metering). Remove the now-stale "slice 1 / follow-up" comment.

### Mobile — the 4 hooks send keyless when Pro

- Make `api_key` **optional** in the request types: `GenerateRequest.api_key?: string`
  (`mobile/src/api/client.ts`) and `MakePostRequest.api_key?: string`
  (`mobile/src/api/derivativesClient.ts`); omit the field when absent (never `""`).
- In each of `useGenerateTopic`, `useGenerateAll`, `useGenerateChapterQuiz`, `useMakePost`: add
  `useBillingPlan` → `const knownNotPro = plan != null && plan.is_pro === false;`. Replace
  `if (!apiKey) { setError("No API key saved…"); return; }` with
  `if (!apiKey && knownNotPro) { setError("No API key saved…"); return; }`, and pass
  `api_key: apiKey ?? undefined` (omit) into the request. Keep each hook's existing error-string wording.
- `useGenerateChapterQuiz` builds a `GenerateRequest` inline (`api_key: apiKey`) → change to
  `...(apiKey ? { api_key: apiKey } : {})` (omit when keyless).

## Testing

- **Backend (`/derivatives/post`, DB-backed):** a request with **no api_key** from an account with a
  granted `managed_unlimited` entitlement (+ a configured managed key) → accepted (not 400); a
  staff-allowlisted account → accepted; neither → 400; over-cap → 429. Mirror the trust
  `resolve_managed_access` test setup (real entitlement row / monkeypatched `_MANAGED_EMAILS`; do NOT stub
  `resolve_managed_access`). Local test DB only (never the `.env` prod pooler).
- **Mobile (RNTL), each hook:** no key + `is_pro:true` → the request is submitted with **no** `api_key`
  (keyless), does NOT error; no key + `is_pro:false` (and `plan:null`) → the "add a key" error, no submit;
  key present → BYOK (`api_key` sent). Cover at least `useGenerateTopic` (or generate-all) + `useMakePost`
  + `useGenerateChapterQuiz`. No color-literal asserts.

## Rollout

**Backend refresh** (derivatives change; force-recreate api + celery-worker) + **web deploy** + **APK**.
No migration. Backend + web ship together (the managed 400/429 shapes).

## Out of scope

- Derivatives metering (still deferred — parity here is eligibility, not usage recording).
- The `/generate` backend (already managed-aware). BYOK behavior when a key is saved (unchanged).

## Global constraints

- ADR-001: the managed/BYOK key never logged/persisted/in a traceback. Fail-open on `plan == null`; never
  send `api_key: ""`. Backend `ruff check` + `ruff format --check`; mobile `npx tsc --noEmit` + full
  `npx jest` + `npx eslint .`. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
