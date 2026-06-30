# ADR-022 — Account deletion removes the Supabase auth identity

**Status:** Accepted — built (2026-06-28). Backend identity-deletion path + both
delete endpoints wired; mobile self-service delete also wipes the device; opt-in via
a service-role key (off by default). _Decision-maker:_ Sivakumar Mambakkam.
**Builds on / Amends:** **ADR-014** (external IdP, verified by JWKS; *"we build NO
authentication… no auth DB, no secret"*). This ADR **amends** that stance for the
**deletion path only**: the backend may now hold the Supabase **service-role key** and
call the Auth Admin API to delete an auth user. **Relates:** **ADR-001**
(no-key-in-logs discipline — the service-role key is never logged), **ADR-020** (the
admin `delete_user` endpoint), **ADR-018** (distinct from `system_owner_secret`).

## Context

Both account-deletion paths — the in-app **"Delete account"** (`DELETE
/api/v1/account`) and the admin **"Delete user"** (`DELETE /api/v1/admin/users/{sub}`)
— only purged the app DB `account` row (provider/device rows cascade). They left the
**Supabase auth identity** intact. Consequence: the same Google/email signs back in
as a **returning** identity, never a fresh registration. This blocked the common
**test loop** ("delete my account, sign up again as a new user") and is surprising for
a real user who expects "delete account" to actually remove their sign-in.

The gap was deliberate under ADR-014: deleting an auth user requires the Supabase
**service-role key** (a full RLS/auth-admin bypass), and ADR-014 kept that secret out
of the app runtime. The documented workaround was the out-of-band
`scripts/reset_test_user.py`. That's fine for maintenance but can't serve the in-app
"Delete account" button.

## Decision

Allow the backend to **hard-delete the Supabase auth identity** on account/user
deletion, **gated on an optional service-role key**:

- **D1 — Opt-in, graceful degradation.** A new optional setting
  `SUPABASE_SERVICE_ROLE_KEY` (+ optional `SUPABASE_URL`, else derived from
  `OIDC_ISSUER`). **Unset ⇒ identity deletion is OFF** and both endpoints keep the
  exact pre-existing behavior (app-row-only purge). Never a startup failure. So the
  anonymous demo and any environment without the key are unaffected.
- **D2 — One thin module.** `backend/src/auth/identity_admin.delete_identity(sub)`
  calls `DELETE {supabase}/auth/v1/admin/users/{sub}` (the JWT `sub` *is* the Supabase
  user id). 200/204/404 ⇒ success (404 = already gone, idempotent). It reuses exactly
  the Auth Admin call already proven in `scripts/reset_test_user.py`.
- **D3 — Identity-first ordering.** Endpoints delete the identity **before** the DB
  row. If the (enabled) external call fails it **raises** before any DB mutation, so
  nothing is left half-deleted; the client can retry. When disabled it's a no-op and
  the DB-row purge proceeds as before.
- **D4 — Secret discipline (ADR-001).** The service-role key is **never logged** (it
  travels only in request headers), never persisted, set per-environment, never
  committed. This is the same discipline as `byok_master_key` / `system_owner_secret`.
- **D5 — Client completes the reset.** The in-app "Delete account" also calls
  `clearDeviceData()` (API keys, local library, onboarding) so the next sign-in is a
  clean first run. The backend can't reset a device; the client must.

## Why this is acceptable (reconciling with ADR-014)

ADR-014's "no auth machinery" was about not **building authentication** (login,
password/refresh-token storage, OAuth plumbing) — and we still don't. This adds a
single, **destructive, idempotent** admin call on an explicit delete, behind an
opt-in secret, with identity-first consistency and audit (admin path). The blast
radius of the key is real (full auth-admin bypass), so it stays **optional and
per-environment**: enable it where the in-app delete must fully remove identity
(e.g. test/staging, and prod if product wants true self-delete), leave it off
elsewhere.

## Consequences

- **Test loop works:** with the key set, "Delete account" → sign in again = a brand
  new user. The same is true for admin "Delete user".
- **`scripts/reset_test_user.py` stays** as the out-of-band path (delete by email
  without being signed in; resets accounts the app can't reach).
- **Prod posture is a separate call:** shipping the code is safe (off by default).
  Whether to set the key in **production** (so real users self-deleting also drop
  their identity) is an operational decision — there's a security tradeoff in giving
  the prod backend the service-role key. Documented in `backend/env.example`.

## Prod posture decision (2026-06-30) — keep prod OFF

`SUPABASE_SERVICE_ROLE_KEY` stays **unset in production** for now. _Decision-maker:_
Sivakumar Mambakkam.

**Rationale.** The service-role key is the highest-blast-radius secret in the system:
unlike the DB credentials and `byok_master_key` the prod VPS already holds, it grants
full Supabase **Auth-Admin** — an attacker who compromised the backend could mint a
session for / impersonate **any** user, and Supabase service-role is all-or-nothing
(no granular scope). At current scale real-user self-deletions are **rare**, so the
out-of-band `scripts/reset_test_user.py` covers the occasional true identity removal
without parking a project-admin secret on the always-on, internet-facing box. This
matches **D7** (quality-first, not scale-first). The local test-loop benefit does not
need prod-on — the script already serves local/dev.

**Accepted cost.** Until this flips, a real user's in-app "Delete account" in prod
purges only the app DB row; the **Supabase auth identity (email + `sub`) persists**
until cleared via the script — residual PII to reconcile against the GDPR "purge
within 30 days" posture, handled operationally for now.

**Revisit trigger — flip prod ON when _either_ holds:**
1. Self-serve deletion volume makes per-deletion script runs impractical (ops burden /
   GDPR-timeliness risk), **or**
2. Prod secret handling is hardened — service-role key in a managed secret store with
   rotation, not a plaintext env var on the VPS.

## Alternatives considered

- **Backend stays out of it; only the script deletes identities.** Rejected — can't
  back the in-app button; every test reset needs a terminal.
- **A separate micro-service holding the service-role key.** Over-engineered for one
  idempotent call; deferred unless the key's blast radius needs isolating.
