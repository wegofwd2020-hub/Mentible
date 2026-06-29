# ADR-020 — Super-admin operator role (runtime admin console)

**Status:** Accepted — **built & verified live** (updated 2026-06-27). Tickets #1
(role gate + portable `VerifiedToken` seam), #2 (`/api/v1/admin/users` list / get /
suspend / reactivate / delete), #5 (persistent `admin_audit`) shipped; mobile admin
console shipped. Suspend→audit→reactivate→delete + 403-for-non-admin **verified live on
production** (2026-06-27). _Original: Proposed 2026-06-19._ Deferred tickets: #3
(library publish), #4 (metrics), #6 (managed-keys, blocked on ADR-005 vault).
**Decision-maker:** Sivakumar Mambakkam
**Resolves:** [#174](https://github.com/wegofwd2020-hub/StudyBuddy_SelfLearner/issues/174)
**Builds on / Extends:** **ADR-018** (system-owner principal). ADR-018 introduced
**one out-of-band, config-defined principal** whose only job is owning & signing the
default library, and it explicitly declared itself **"not an RBAC system, not a
per-user admin console"** and warned the principal "must never grow into a general
admin/RBAC system or gain read access to user content." **This ADR is the deliberate
decision to add that operator tier** — consciously, with guardrails, and reconciled
with ADR-018 (see D4). **Extends:** **ADR-014** (flat IdP accounts; the JWKS→`Principal`
seam — we add a *derived* admin flag, not an IdP claim or a DB role at MVP).
**Relates:** **ADR-005** (managed-key vault & plans — the plan/managed-key admin
operations depend on the vault build and are forward-looking here), **ADR-001**
(no-key-in-logs / never-display-key discipline — the admin surface never returns key
material), **ADR-019** (common platform libraries — D8 below applies its
package-vs-per-app boundary to this role; the authentication seam is shared, the
authorization is not).
**Amends:** the `CLAUDE.md` non-negotiable **"Single-tenant by user, no RLS… no
multi-tenancy."** ADR-018 already narrowed it with one principal *above* the flat
model; this ADR narrows it further by allowing a **deliberate, metadata-only,
audited cross-account read** for the operator. It does **not** reintroduce per-tenant
RLS (see D3/D5).
**Implemented by:** follow-up tickets (this ADR lands the decision only — the operator
chose "ADR first"). No code in this change.

---

## Context

Mentible's identity model is deliberately **flat** (ADR-014): every account is an
equal, self-service, IdP-verified user (`Principal{sub, email, issuer}` from
`backend/src/auth/`), anonymous-first, with **no roles**. The only privilege that
exists today is the **ADR-018 system-owner** — a `SYSTEM_OWNER_SECRET` (64-hex)
config value used *out-of-band* by `owner_cli {publish,unpublish,verify}` to HMAC-sign
default-library books. There is **no runtime, IdP-authenticated operator** anywhere:
no way for the product owner to, while logged in, see who has signed up, adjust a
managed plan, publish a default book without shelling into a box, or look at usage to
support a stuck user.

As the product moves toward a public launch (ADR-005 pulled accounts + managed
billing to MVP), that operator gap becomes real work: **someone has to run the
product** — manage users, manage managed-key plans/allowances, curate the default
library, and read metrics/support state. Today all of that is either impossible or
requires the owner secret + a shell.

This ADR defines a **super-admin operator role**: a small allowlist of real,
IdP-authenticated humans who get a gated admin console. It is intentionally the RBAC
tier ADR-018 said it was not — so the central design problem is **adding it without
betraying the flat model, the BYOK promise, or data-minimisation**: narrow scope, one
tier, metadata-only cross-account access, never key material or user content, fully
audited, and cleanly separated from the ADR-018 signing secret.

---

## Decision (proposed)

### D1 — Super-admin = an env allowlist of verified identities (no DB role at MVP)

A comma-separated **`SUPER_ADMIN_EMAILS`** (and optional `SUPER_ADMIN_SUBS`) config
value lists the operators. An account is super-admin iff its **JWKS-verified** `email`
(or `sub`) is in the allowlist. Empty/unset allowlist ⇒ **no admins** (safe default;
the demo and anonymous mode are unaffected). Email is the operator-friendly key;
`sub` is allowed for stability if an email ever changes.

We do **not** add a `role` column to the `account` table at MVP. Keeping the admin
decision in config preserves ADR-014's "no auth DB; identity is verified, not stored
for authz" stance and needs no migration. Graduating to a DB-stored role (set by
another admin, for non-engineer operators) is **O1**.

### D2 — A *derived* `is_super_admin`, never a trusted token claim

`Principal` gains a server-derived `is_super_admin: bool`, computed **at verify time**
by comparing the verified identity against the D1 allowlist — **not** read from a JWT
claim (a client must never be able to assert its own admin status). A
`require_super_admin` FastAPI dependency builds on `require_user` and returns **403**
for non-admins. `optional_user`/anonymous paths are untouched.

### D3 — A gated `/api/v1/admin/*` surface, four areas

All admin routes sit under `/api/v1/admin/*`, behind `require_super_admin`, TLS-only,
and observable. Scope (per the 2026-06-19 decision):

1. **User management.** List/search accounts; get one; suspend/reactivate; delete
   (full purge, reusing the existing cascade). Cross-account read is the **deliberate
   exception to single-tenant isolation** — and is **metadata only**: `idp_sub`,
   `email`, `created_at`, plan, per-provider credential **source/status**, and usage
   counters. **Never** user-generated content (books/lessons) and **never** key
   material (BYOK or managed). This preserves ADR-014 D8, ADR-018 D3, and ADR-001.
2. **Plans & managed keys** *(ADR-005-dependent, forward-looking).* Set a user's plan
   and metered token allowance; view managed token spend; grant/revoke managed
   access. Bounded by what the managed-vault build (ADR-005) exposes; the admin never
   reads raw managed keys, only plan/allowance/spend metadata.
3. **Default library / content.** An **authenticated, server-mediated** path to the
   ADR-018 publish capability: `POST /admin/library/{publish,unpublish}`. The
   **server** (which already holds `SYSTEM_OWNER_SECRET` in config) performs the HMAC
   signing; the secret is never returned to or held by the client. This **adds** an
   in-product trigger to ADR-018 D5's "out-of-band CLI only" — the CLI remains for
   CI/dev/build.
4. **Metrics & support.** Read-only usage/error metrics; inspect a user's job
   statuses; clear/retry a stuck job. No content access.

### D4 — Reconciling the two privileged concepts (the key decision)

There are now **two distinct things**, composed, not merged:

| | ADR-018 system-owner secret | ADR-020 super-admin role |
|---|---|---|
| **What** | a cryptographic **capability** | a human **operator identity** |
| **Who/where** | machine / CI / server (a 64-hex secret) | a logged-in person (IdP + allowlist) |
| **Used for** | signing default-library manifests | the runtime admin console |
| **At rest** | held/rotated like a prod signing key | nothing stored; derived from config |

They **compose**: a super-admin's *library-publish request* is **authorised** by the
role (D2), and the actual *signing* is done by the server using its configured owner
secret (D3.3). **A super-admin is never given the owner secret.** This keeps "who may
ask" (RBAC) cleanly separate from "the signing capability" (the secret), and means
leaking an admin session does not leak the signing key.

### D5 — Audit & hard guardrails

Every admin action is **logged** (actor `sub`+`email`, action, target, timestamp; no
secrets) — same discipline as ADR-018 D6. A persistent `admin_audit` table is
recommended (**O2**). Non-negotiable guardrails, so this stays the narrow tier
ADR-018 feared and not a creeping RBAC engine:

- cross-account access is **metadata only** — never user content, never key material;
- exactly **one** elevated tier (super-admin); no role hierarchy, no per-resource ACLs;
- the allowlist is **small and config-managed**;
- admin endpoints are TLS-only, audited, and rate-limited/observable;
- the admin surface is **additive** — the flat user model, anonymous mode, and BYOK
  promise are otherwise unchanged.

### D6 — Surface staging: backend role + API first, UI later

Ship the role gate + the `/admin/*` API first (drivable by curl/scripts) — the
operator chose "ADR first," and the API is the smallest safe increment. A UI is a
follow-up; given the operator audience, a **separate minimal web admin** may be
cleaner than shipping admin UI inside the consumer mobile app (**O4**). The consumer
app shows nothing admin at MVP.

### D7 — IdP-level user operations are optional and server-only

"Suspend"/"delete" act on **our** `account` table by default (our flag / our cascade
purge). Disabling/deleting a user **at the Supabase IdP** (so they can't re-mint a
token) requires the Supabase **service-role key** — a separate, server-only managed
secret, used only if we choose IdP-level management (**O3**). Not wired at MVP.

### D8 — Portability across the product family (shared auth seam, per-app authorization)

This role must be reusable in **Pramana** and **kathai-chithiram** without forcing a
shared authorization model on three products that disagree at the root. We apply the
**ADR-019** package-vs-per-app boundary, stated once there:
**`wegofwd-identity` answers "is this token valid and who does it claim to be?"; each
app answers "is that caller an admin, and what may they do?"**

**What is shared (packaged → `wegofwd-identity`).** Only the stateless authentication
slice: JWKS fetch/cache/rotation + JWT signature/`iss`/`aud`/`exp` verification,
returning a **minimal `VerifiedToken{ sub, email, issuer, raw_claims }`** — no DB, no
`Principal`, no roles. This is the slice **ADR-019 D4** named; its "second consumer"
trigger is **now met** — Pramana already ships JWKS auth
(`pramana/services/auth.py`) and Mentible has its own (`backend/src/auth/verifier.py`).

**What stays per-app (a copyable *pattern*, not shared code).** The super-admin gate
is the ~30-line idiom **parse config allowlist → derive `is_super_admin` → expose a
`require_super_admin` dependency**, built *on top of* the shared seam. Each product
maps `VerifiedToken → its own Principal` and derives admin its own way, because the
authorization models genuinely differ:

| | Mentible (this ADR) | Pramana (today) | kathai-chithiram |
|---|---|---|---|
| Principal | `{sub,email,issuer}`, flat, no-DB | `{user_id,tenant_id}`, DB, multi-tenant | unknown / unstarted |
| Admin model | one config-allowlist tier (D1) | existing 5-role DB RBAC | TBD |

Forcing those into one shared authz abstraction would fight both (ADR-019 D4/D5:
roles/entitlements are the "should drift, keep per-app" category). The admin
**operations** themselves (D3's four areas) are inherently product-shaped and likewise
stay per-app.

**Sequencing — pattern-first (ADR-019 Sequencing step 3).** Implement ticket #1
**in-repo now**, but code the verifier to return a `VerifiedToken`-shaped result so the
extractable seam already has its final *shape*; extract `wegofwd-identity` (verify→
claims only) later, when a consumer is actually wired to it, so the package API is
frozen against two real callers rather than one-and-a-half. No cross-repo package work
blocks Mentible's admin gate.

**Guardrail:** `wegofwd-identity` must **never** grow roles, a `Principal`, a DB, or
entitlements — if a "shared admin/RBAC library" is ever proposed, that is a new ADR,
not a drift of this one.

---

## Open decisions

- **O1 — Allowlist (config) vs DB `role` column.** Start with the env allowlist;
  graduate to a DB-stored role (set by another admin) once admins change often or
  non-engineers must manage them.
- **O2 — Audit sink.** Ephemeral `structlog` only, or a persistent `admin_audit`
  table from day one (recommended for a privileged surface).
- **O3 — Supabase service-role usage** for IdP-level disable/delete vs our-DB-only.
- **O4 — Admin UI form factor:** an admins-only section in the consumer app vs a
  separate web admin app.
- **O5 — Plan / managed-key admin ops** are gated on the ADR-005 managed-vault build;
  exactly what is exposed (and when) follows that work.
- **O6 — "Suspended" semantics.** What a suspended account can/can't do. Note
  generation endpoints are public + BYOK (key in body), so a suspend that only blocks
  `require_user` routes does **not** stop BYOK generation — decide whether suspend
  must also gate generation.

## Consequences

**Positive:** the product becomes **operable** — users, managed plans, default-library
publishing, and support/metrics are all reachable by an authenticated operator;
publishing no longer needs a shell; the operator identity is cleanly separated from
the signing secret (D4), so the two have independent blast radii; scope stays narrow,
metadata-only, and audited.

**Negative / risk:** this is the **general admin/RBAC tier ADR-018 explicitly warned
against** — accepted here deliberately as the product approaches launch. It narrows
the single-tenant non-negotiable further (a real cross-account read path now exists,
even if metadata-only). It is new privileged surface to build and secure, and an
allowlist can drift (stale operators). The guardrails in D5 exist precisely to keep
it from metastasising.

**Migration:** additive. No schema change at MVP (allowlist is config). Anonymous /
device-local remains the zero-account baseline; existing user and owner behaviour is
unchanged.

## Scope — what this ADR is *not*

Not a general roles engine (one tier only), not per-tenant RLS, not user-content
access, not the managed-billing/metering design (ADR-005 follow-up), not the admin-UI
visual design. It fixes **who the runtime operators are, how they are identified and
gated, what the admin console may do, and how that reconciles with the ADR-018
signing secret** — leaving the items in Open Decisions to the decision-maker.

## Follow-up tickets

1. **✅ DONE.** Config allowlist (`SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_SUBS`) + derived
   `Principal.is_super_admin` + `require_super_admin` dependency (D1, D2). Shape the
   verifier to return a `VerifiedToken{sub,email,issuer,raw_claims}` and map it to
   `Principal` in app code, so the future `wegofwd-identity` seam is import-aligned (D8).
2. **✅ DONE.** `/api/v1/admin/*` user-management endpoints — list/get/suspend/delete, **metadata
   only** (D3.1). Verified live on prod 2026-06-27.
3. **⏳ Not built.** Server-mediated default-library `publish`/`unpublish` endpoint reusing the ADR-018
   signing (D3.3, D4). (`owner_cli` exists but is CLI-only.)
4. **⏳ Not built.** Metrics/support endpoints — usage, job inspect, job clear/retry (D3.4).
   Deferred with managed billing.
5. **✅ DONE.** Audit logging + optional `admin_audit` table (D5, O2 → resolved to a durable table).
6. **⏳ Blocked.** Plans / managed-key admin operations, gated on the ADR-005 vault (D3.2, O5).
   The managed vault isn't built yet; only the BYOK path is live.
7. **◑ Partial.** Admin UI per O4. In-app/web admin console (`mobile/app/admin.tsx`) is built;
   the separate-web-admin form-factor question (O4) is still open.
8. **✅ DONE (PR #219).** Reconcile `CLAUDE.md` (the "single-tenant, no RLS" non-negotiable + the locked-
   decisions / document-map tables) now that implementation has landed.
