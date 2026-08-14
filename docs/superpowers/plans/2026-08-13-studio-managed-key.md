# Studio managed (system-key) generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the managed ("system API key") path to the Studio surface — its generators run keyless on our managed key when the user is Pro + has no BYOK key, at parity with the trust workspace.

**Architecture:** `/generate` (used by 3 of the 4 Studio hooks) already honors managed — those are client-only. `/derivatives/post` (make-post) gates on the old allowlist-only `is_managed_eligible`; upgrade it to the `/generate` DB-managed pattern (`resolve_managed_access` + `over_cap`). Client: make `api_key` optional + send keyless when Pro (mirror the trust #433 fix).

**Tech Stack:** FastAPI + asyncpg (backend); React Native (Expo) (mobile); pytest; Jest + RNTL.

## Global Constraints

- **Keyless when Pro, fail-open:** only show "No API key saved…" when **known not-Pro** (`plan != null && plan.is_pro === false`); `plan == null` (loading) ⇒ keyless, backend decides. NEVER send `api_key: ""` — omit it.
- ADR-001: managed/BYOK key never logged/persisted/in a traceback.
- Backend `ruff check .` + `ruff format --check .`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. DB tests: local `mentible_test` (:5439) ONLY — the `.env` `DATABASE_URL` points at a PROD pooler (conftest now guards this, but still pass a local DSN). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `/generate` DB-managed block = `generate/router.py:117-152` (target pattern: `db_pool = getattr(request.app.state, "db", None)`; `accounts_repo.get_or_create_account` → `access.resolve_managed_access` → `access.over_cap`→429; `elif not is_managed_eligible(...)`→400). `derivatives/router.py` `make_post(body: DerivativeRequest, principal = Depends(optional_user))` — has NO `request` param yet; its managed block (`:61-77`) is `is_managed_eligible`-only + a "slice 1 follow-up" comment; imports `is_managed_eligible`, `get_managed_key`. Mobile hooks: `useGenerateTopic`/`useGenerateAll` build the request via `buildGenerateRequest({ topic, apiKey, params, instructions })`; `useGenerateChapterQuiz` builds a `GenerateRequest` inline (`api_key: apiKey`); `useMakePost` builds inline (`api_key: apiKey`). All four gate `if (!apiKey) { setError("No API key saved. Go to Settings and paste your Anthropic key."); ...; return; }`. `useBillingPlan(): { plan, loading }`, `PlanStatus.is_pro`. `MakePostRequest.api_key: string` (`derivativesClient.ts`). Existing backend test to extend: `backend/tests/test_derivatives_post.py`.

---

### Task 1: Backend — `/derivatives/post` honors managed entitlements

**Files:**
- Modify: `backend/src/derivatives/router.py` (`make_post`)
- Test: `backend/tests/test_derivatives_post.py`

**Interfaces:**
- Produces: `POST /derivatives/post` with no `api_key` succeeds for a managed-**entitled** account (not only staff-allowlisted); 400 if ineligible; 429 if over cap.

- [ ] **Step 1: Write the failing test** in `test_derivatives_post.py` (mirror the trust `resolve_managed_access` tests + the file's existing fixtures/TestClient). Cases (mock the provider call `generate_post` so no real LLM; set a managed key via `monkeypatch.setattr(settings, "managed_anthropic_api_key", "sk-ant-"+"x"*20)`):
  - no `api_key` + an account with a granted `managed_unlimited` entitlement (via `entitlement_repo.set_entitlement`) → **not** 400 (request proceeds);
  - no `api_key` + a **staff-allowlisted** account (monkeypatch `eligibility._MANAGED_EMAILS`) → **not** 400;
  - no `api_key` + neither → **400** "an api_key is required for this request";
  - do NOT stub `resolve_managed_access`. (If the endpoint needs a DB app-state to resolve entitlements, ensure the TestClient app has `app.state.db` like the `/generate` managed tests do — follow that test's setup.)

- [ ] **Step 2: Run — FAIL** (entitlement path currently 400s; only allowlist works).

- [ ] **Step 3: Implement** in `make_post`:
  - Add `request: Request` to the signature (import `Request` from fastapi). Add imports `from backend.src.accounts import repo as accounts_repo` and `from backend.src.billing import access`.
  - Replace the `if managed:` block (`:61-77`) with the `/generate` pattern (verbatim shape from `generate/router.py:117-152`):
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
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "an api_key is required for this request")
                if await access.over_cap(conn, account_id=account.id, access=grant):
                    raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "managed allowance exhausted; try again later or add your own key")
        elif not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "an api_key is required for this request")
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    ```
  - Remove the stale "SCOPE (slice 1)… follow-up" comment. Keep everything else (image check, `get_managed_key`, the `asyncio.to_thread(generate_post, …)` call) unchanged.

- [ ] **Step 4: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_derivatives_post.py -q` (local DSN). Commit:
```bash
git add backend/src/derivatives/router.py backend/tests/test_derivatives_post.py
git commit -m "feat(derivatives): /post honors managed-plan entitlements (resolve_managed_access + over_cap), not just the staff allowlist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Mobile — the 4 Studio hooks send keyless when Pro

**Files:**
- Modify: `mobile/src/api/client.ts` (`GenerateRequest.api_key?`; `buildGenerateRequest` if it lives there), `mobile/src/api/derivativesClient.ts` (`MakePostRequest.api_key?`), `mobile/src/hooks/useGenerateTopic.ts`, `useGenerateAll.ts`, `useGenerateChapterQuiz.ts`, `useMakePost.ts`
- Test: the hooks' existing tests (find/extend, e.g. `mobile/__tests__/hooks/*`) or add per-hook tests

**Interfaces:**
- Consumes: `useBillingPlan`, `getApiKey`/`loadApiKey`, `submitGenerate`, `makePost`.

- [ ] **Step 1: Make `api_key` optional in the request types + builder.**
  - `GenerateRequest.api_key?: string` in `client.ts`; `submitGenerate` sends the object as-is (`JSON.stringify` drops `undefined`). If `buildGenerateRequest` lives in `client.ts` (or wherever `useGenerateTopic` imports it), make its `apiKey` param optional and set `...(apiKey ? { api_key: apiKey } : {})` (omit when absent).
  - `MakePostRequest.api_key?: string` in `derivativesClient.ts`.

- [ ] **Step 2: Write the failing tests.** For `useGenerateTopic` (or `useGenerateAll`), `useGenerateChapterQuiz`, and `useMakePost`: mock `getApiKey`/`loadApiKey`, `useBillingPlan`, and the submit fn (`submitGenerate`/`makePost`). Assert:
  - no key + `is_pro:true` → the submit fn is called with a request that has **no** `api_key` (keyless), no error set;
  - no key + `is_pro:false` (and `plan:null`) → the "No API key saved…" error, submit NOT called;
  - key present → submit called with `api_key` set (BYOK).
  No color-literal asserts.

- [ ] **Step 3: Run — FAIL** (hooks still throw on no-key regardless of Pro).

- [ ] **Step 4: Implement in each of the 4 hooks.** Add `const { plan } = useBillingPlan();` and `const knownNotPro = plan != null && plan.is_pro === false;`. Change the gate to `if (!apiKey && knownNotPro) { setError("No API key saved. Go to Settings and paste your Anthropic key."); setStatus("failed"); return; }` (keep each hook's exact existing message + status/return shape). Pass the key through as optional:
  - `useGenerateTopic`/`useGenerateAll`: `buildGenerateRequest({ …, apiKey: apiKey ?? undefined, … })`.
  - `useGenerateChapterQuiz`: in the inline `GenerateRequest`, replace `api_key: apiKey` with `...(apiKey ? { api_key: apiKey } : {})`.
  - `useMakePost`: replace `api_key: apiKey` with `...(apiKey ? { api_key: apiKey } : {})`.

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. All green. Commit:
```bash
git add mobile/src/api/client.ts mobile/src/api/derivativesClient.ts mobile/src/hooks mobile/__tests__
git commit -m "feat(studio): keyless (managed) generation for Pro users across the Studio generators

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_derivatives_post.py -q` (local DSN); `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] `/derivatives/post` accepts a managed-**entitled** (not just allowlisted) keyless request; the 4 Studio hooks send keyless when Pro + no key; Free/no-key keeps the message; BYOK unchanged. Never `api_key: ""`.
- [ ] **Deploy:** backend refresh (force-recreate api + celery-worker) + web + APK. No migration.

## Out of scope

- Derivatives metering (still deferred). The `/generate` backend (already managed). BYOK-with-key behavior.
