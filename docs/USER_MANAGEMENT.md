# User Management — design, implementation & troubleshooting

> **Status:** Built and **verified working end-to-end on-device** (2026-06-16).
> **Companion to:** **ADR-014** (the account/identity *decisions*) and **ADR-019**
> (this is the "build identity *here* first, extract on the second consumer" case —
> see §5 *Porting*). This doc is the *how*: the architecture, the file map, the
> config, and the runbook of every setup gotcha we hit, so the next tool in the
> family (Pramana, kathai-chithiram) doesn't re-discover them.

Built across PRs #134, #135, #136, #137, #138, #139, #140, #141, #142, #143, #144.

---

## 1. Design

### 1.1 Identity — verify, don't build (ADR-014 D1)
We build **no authentication**: login is an external IdP's job (**O1 → Supabase**).
The backend only **verifies** the IdP's JWT **statelessly via JWKS** — check the
signature against the published keys, then issuer, audience, expiry — and derives a
`Principal`. No passwords, no refresh rotation, **no auth DB**. The session JWT is
*our* token, never an LLM/BYOK key.

- **Asymmetric only.** The verifier accepts **RS256/ES256** and deliberately
  **rejects HS256** — a JWKS verifier must never trust a symmetric algorithm (a
  leaked public key would become a signing key). This means the Supabase project
  **must use asymmetric JWT signing keys** (see §4).
- **Vendor-agnostic.** The verifier takes `issuer`, `audience`, and a key resolver.
  Production wires a cached `PyJWKClient`; tests inject a local public key. Swapping
  Auth0/Clerk for Supabase is config, not code.
- **Optional.** Unset `OIDC_ISSUER` ⇒ identity disabled (the anonymous demo); the
  app runs accountless and never fails startup.

### 1.2 Account = a per-provider *credential set*, not "a key" (ADR-014 D2/D3/D8)
The account stores only an identity reference and provider-credential **metadata** —
**never key material**, and nothing about what the user generates (D8).

```
account(id uuid pk, idp_sub text unique, email text, created_at, synced_library_ref)
provider_credential(account_id fk→account ON DELETE CASCADE, provider_id text,
                    source, status, last_verified_at, updated_at,
                    primary key (account_id, provider_id))
  source ∈ device_local | synced_e2e | managed_vault     -- CHECK-constrained
  status ∈ valid | rejected | unverified                 -- CHECK-constrained
```
- **Rows, not columns** — adding a provider (DeepSeek, Qwen…) needs no migration (D2).
- **No key material** — the BYOK key stays device-local or is synced as ciphertext (D5).
- **Cascade** — `delete_account` purges credentials too (the D8 account deletion).

### 1.3 Data path & isolation — backend-mediated, app-level (decision)
The FastAPI backend is the **single data path**; it already verifies the JWT, then
scopes every query by the verified `idp_sub` (`WHERE idp_sub = principal.sub`). **No
RLS.** This follows CLAUDE.md rule 4 ("single-tenant by user, no RLS") over ADR-014's
RLS lean — chosen because the backend authenticates and a mediating server + RLS
fights connection pooling. (RLS remains a possible defense-in-depth layer later.)

### 1.4 Resolved decisions
- **O1 → Supabase** (bundles auth + the sync Postgres + RLS option).
- **O5 → Supabase Postgres** (follows O1).
- Auth method: **email+password first** (Google later).
- Session storage: **encrypted "LargeSecureStore"** — AES-256 ciphertext in
  AsyncStorage, the AES key in expo-secure-store (honors D1 without secure-store's
  ~2 KB limit). *Web falls back to AsyncStorage — secure-store is native-only.*

---

## 2. Implementation map

### Backend (`backend/`)
| Area | Files | PR |
|---|---|---|
| Identity verify | `src/auth/principal.py` (`Principal{sub,email,issuer}`, `AuthError`), `src/auth/verifier.py` (`JwtVerifier`, `build_verifier`), `src/auth/deps.py` (`require_user`, `optional_user`) | #134 |
| Account DB | `alembic/` + `alembic.ini` + `versions/0001_account_and_credential_set.py`; `src/db/pool.py` (asyncpg pool), `src/accounts/models.py`, `src/accounts/repo.py` | #135 |
| Account API | `src/db/deps.py` (`get_conn`), `src/accounts/schemas.py`, `src/accounts/router.py` (`GET/PUT/DELETE /api/v1/account[/credentials/{id}]`); pool wired in `main.py` lifespan; CORS gains PUT/DELETE + Authorization | #136 |
| Config | `config.py`: `oidc_issuer/oidc_audience/oidc_jwks_url`, `database_url` — all optional | #134/#135 |

Routes (all `require_user`, scoped to `idp_sub`): `GET /account` (lazily provisions
the row on first authenticated call), `PUT /account/credentials/{provider_id}`,
`DELETE /account/credentials/{provider_id}`, `DELETE /account` (D8 purge).

### Mobile (`mobile/`)
| Area | Files | PR |
|---|---|---|
| Account client | `src/api/accountClient.ts` (Bearer session token → backend) | #137 |
| Supabase client | `src/lib/supabase.ts` (env-driven; `null` when unconfigured; platform-aware storage) | #139/#143 |
| Auth context | `src/auth/AuthProvider.tsx` (`useAuth`: session, accessToken, signIn/signUp/resetPassword/signOut) | #139/#140 |
| Session storage | `src/secure/largeSecureStore.ts` (AES via `aes-js`+`expo-crypto`, key in `expo-secure-store`) | #139 |
| Data hook | `src/hooks/useAccount.ts` | #140 |
| Screens | `app/sign-in.tsx`, `app/account.tsx`, Account row in `app/(tabs)/settings.tsx`, `AuthProvider`/routes in `app/_layout.tsx` | #140 |
| Deps | `@supabase/supabase-js`, `react-native-url-polyfill`, `aes-js`, `expo-crypto`, `@opentelemetry/api` | #139/#142 |

### CI & tests
- **Mobile CI job** `Mobile — Tests (Jest)` (#138) — the repo's first mobile CI.
- **Backend** test job gained a **Postgres 16 service** + `alembic upgrade head` (#135).
- **Owner-signing constant:** the default-library publish uses the `1×64` dev constant
  the suite expects — see CLAUDE.md **pitfall #7**. (Unrelated to user auth, but the
  same `SYSTEM_OWNER_SECRET` knob.)
- Tests: `test_auth_jwks` (15), `test_accounts_repo` (10, real PG), `test_account_api`
  (8, TestClient+PG); mobile `largeSecureStore` (4), `AuthProvider` (4), `useAccount`
  (4), `accountClient` (6).

---

## 3. Configuration

Three env surfaces (see the committed `env.example` files):

| File | Used by | Key vars |
|---|---|---|
| **root `env.example` → `.env`** | Docker stack (`./dev_start.sh up`) — compose interpolates into the `api` service | `OIDC_ISSUER`, `DATABASE_URL` (+ `BYOK_MASTER_KEY`, `SYSTEM_OWNER_SECRET`, `SUPER_ADMIN_EMAILS` — see §3.1) |
| **`backend/env.example` → `backend/.env`** | backend run **without** Docker (pydantic reads it) | same as above |
| **`mobile/env.example` → `mobile/.env.local`** | the app | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL` |

Supabase values: `OIDC_ISSUER = https://<ref>.supabase.co/auth/v1`, `OIDC_AUDIENCE =
authenticated`. **Run the migration before the account API works** (`alembic upgrade
head` against `DATABASE_URL`) — otherwise the routes 500 with "relation account does
not exist".

### 3.1 Super-admin operator allowlist (ADR-020)

The runtime admin console (`/api/v1/admin/*`) is gated on a config allowlist of
**verified IdP identities** — `SUPER_ADMIN_EMAILS` (comma-separated, matched
case-insensitively against the verified `email` claim) and optional
`SUPER_ADMIN_SUBS`. Empty/unset ⇒ **no admins** (safe default). It is the human
**operator role**, distinct from `SYSTEM_OWNER_SECRET` (a signing capability) —
see ADR-020 D2/D4.

**Production operator (staged here for go-live): `SUPER_ADMIN_EMAILS=wegofwd2020@gmail.com`.**
Set this on the **identity-enabled** deployment's env (the same surface as
`OIDC_ISSUER`/`DATABASE_URL` above — root `.env` for the Docker stack), then restart.

> ⚠️ **It does nothing until the rest of the auth stack is live.** `require_super_admin`
> builds on `require_user`, so without `OIDC_ISSUER` configured there is no login to
> match, and the admin routes need `DATABASE_URL` + migrations. As of 2026-06-20 the
> only deployed backend is the **anonymous demo** (`/mentible-api`, no OIDC, no DB,
> stale image), so the var is **not yet set on the VPS** — it is recorded here to set
> at go-live. Go-live order: deploy the current image → set `OIDC_ISSUER` (+ Google
> provider) → set `DATABASE_URL` + `alembic upgrade head` → set `SUPER_ADMIN_EMAILS`.

---

## 4. Troubleshooting runbook (every gotcha we hit)

| Symptom | Cause | Fix |
|---|---|---|
| Backend startup: `tenant/user postgres.<ref> not found` | Wrong Supabase **pooler region/instance** in `DATABASE_URL` | Copy the exact host from Supabase → **Connect → Session pooler**. The `aws-N-<region>` prefix is project-specific & unguessable (ours: `aws-1-us-west-2`). |
| Startup: `socket.gaierror: Name or service not known` (in Docker) | Using the **direct host** `db.<ref>.supabase.co` — it's **IPv6-only**, and Docker has no IPv6 | Use the **Session pooler** host (IPv4). The direct host works from an IPv6-capable host (e.g. running migrations locally), just not in the container. |
| Same gaierror, but host looks right | Unencoded special char in the password (e.g. `@`) mangles URL parsing → wrong host | URL-encode (`@`→`%40`) **or** reset the DB password to alphanumeric. |
| Connects but odd asyncpg errors | Using the **transaction pooler** (port **6543**) | Use **Session** mode (port **5432**) — transaction mode breaks asyncpg prepared statements. |
| Account API → 401 | Token not verifying | Confirm `OIDC_ISSUER` set; the project uses **asymmetric JWT keys** — `curl https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` must return non-empty `keys`. The verifier rejects legacy HS256. |
| Account API → 503 | `DATABASE_URL` unset/unreachable in the container | Set it (compose reads the **root** `.env`), restart. |
| Account screen → 500 "relation account does not exist" | Migration not run | `cd backend && DATABASE_URL=… alembic upgrade head`. |
| `expo start`: `Unable to resolve @opentelemetry/api` | `@supabase/supabase-js` optional import Metro can't resolve | Add the dep (`npx expo install @opentelemetry/api`) — already in repo (#142). |
| Web: `deleteValueWithKeyAsync is not a function` | `expo-secure-store` is **native-only**; web hit `LargeSecureStore` | Platform-aware storage: AsyncStorage on web, secure-store on native (#143). |
| `ModuleNotFoundError: asyncpg` running a script | venv not active | use `.venv/bin/python` / `.venv/bin/alembic`, or `source .venv/bin/activate`. |
| Anyone can sign up unverified | Email confirmation off | It's off only for testing — **re-enable "Confirm email"** for production. |

Fast DB-string check (host, no Docker): `.venv/bin/python -c "import asyncio,asyncpg;
asyncio.run(asyncpg.connect('<DATABASE_URL>')); print('OK')"`.

---

## 5. Porting to another tool (ADR-019)

ADR-019 D3/D4: build identity **here first** (done — this is Mentible), then extract
the **thin, stable core on the second consumer** (Pramana / kathai-chithiram) — not
before. When that second consumer arrives:

**Reusable (extract candidates — the "common, not shared" infra):**
- The **JWKS-verify → `Principal`** seam (`auth/verifier.py` + `principal.py`) — fully
  vendor-agnostic; this is the natural `wegofwd-identity` package (ADR-019 §D4).
- The **credential-set model + repo pattern** (rows-per-provider, no key material).
- **`LargeSecureStore`** (encrypted session, native/web split) and the **`useAuth`**
  contract on the client.
- **This runbook (§4)** — the Supabase/pooler/IPv6/Metro gotchas transfer verbatim.

**Stays per-app (do NOT extract — the "should drift" content of ADR-002):**
- The account **data model beyond `{idp_sub, credential_set}`**, **entitlements /
  metering / billing**, the **provider registry** coupling (each tool's providers
  differ), and **all screens/UX**.
- Whether identity is even on (some tools may stay anonymous).

**Don't extract from one implementation.** Copy-paste into the second tool first;
extract the package once two real consumers have validated the interface (ADR-019).

---

## 6. Not done yet (tracked follow-ups)
- **Super-admin go-live** (ADR-020): admin backend is built (tickets #1/#2/#5), but
  `SUPER_ADMIN_EMAILS=wegofwd2020@gmail.com` is **staged in §3.1, not set on the VPS** —
  set it once the identity-enabled backend is deployed (needs OIDC + DB + current image).
- **Google sign-in** (email+password is in; Google is additive — needs `expo-auth-session`).
- **Library sync + encryption** — ADR-014 **O2 still open** (the zero-knowledge crux).
- **Provenance-driven degradation UX** (D6) · **rate-limiting** (D9).
- **Mobile typecheck + lint in CI** (Jest is in; typecheck needs `@types/jest` wired +
  one stray `@ts-expect-error` cleaned; lint needs the ESLint v9 flat-config migration).
