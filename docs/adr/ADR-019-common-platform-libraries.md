# ADR-019 — Common platform functionality as installable libraries (extract on the second consumer)

**Status:** Proposed — 2026-06-15 · _amended 2026-06-19 (D4 "second consumer" trigger
MET) · amended 2026-06-30 (billing = mechanism vs policy split → a `wegofwd-billing`
candidate)_
**Decision-maker:** Sivakumar Mambakkam

> **Amendment — 2026-06-30 (`wegofwd-billing`: split managed-billing mechanism from
> policy).** D4 lists "entitlements / metering / billing" as **not extractable**. That
> ruling **stands for billing _policy_** — but it conflated two layers. Within managed
> billing (ADR-005 D6, now scoped in [`docs/MANAGED_BILLING_BUILD_PLAN.md`](../MANAGED_BILLING_BUILD_PLAN.md))
> there is a **mechanism** layer that *is* "identical everywhere" and passes the D5
> package test, exactly like the `wegofwd-llm` seam:
> - **Mechanism (packageable → `wegofwd-billing`):** managed-key **vault access** (the
>   *same* provider keys across products), **token→cost metering** + price tables,
>   **payment-processor webhook verification → a generic entitlement record** (RevenueCat,
>   per ADR-005 O1), and a **cap-enforcement engine** parameterised by a policy the app
>   supplies.
> - **Policy (stays per-app, unchanged from D4/D5):** plan definitions, allowances,
>   what-a-plan-grants, the entitlement/usage **DB rows**, and product UX.
>
> **Decision (2026-06-30):** the family gains a **`wegofwd-billing` library** for the
> mechanism; **per-product billing** (each app owns its plans, DB, and subscriptions —
> **no** cross-product wallet, **no** shared service; D1 library-not-service holds).
> **Sequencing is unchanged and binding:** managed billing is **not built even once yet**,
> so **build it in Mentible first, in-repo, behind a clean mechanism seam** (ADR-005
> phases 1–5), and **extract `wegofwd-billing` only when a second consumer actually wires
> to it** — Pramana (which already does managed-vault generation) is the likely trigger.
> Copy-first / extract-on-the-real-second-consumer (D3/D5); no speculative package. See
> the new Sequencing step 4 and D5's billing line.

> **Amendment — 2026-06-19 (D4 trigger met).** D4 made `wegofwd-identity` extraction
> conditional on "a second product that actually needs it." That condition is now
> satisfied: **Pramana has built JWKS auth** (`pramana/services/auth.py` —
> `TokenVerifier`/`KeySource` verifying an OIDC JWT via JWKS → a `Principal`), and
> **Mentible has built its own** (`backend/src/auth/verifier.py`). Two real consumers
> now exist. **Greenlight extracting `wegofwd-identity`, scoped strictly to the D4
> "extractable" slice** — the stateless **JWKS fetch/cache + JWT verify → minimal
> verified-claims** (`{sub, email, issuer, raw_claims}`). The two consumers confirm D4's
> per-app boundary is real and must hold: their **`Principal` shapes differ** (Mentible
> `{sub,email,issuer}`, flat/no-DB/anonymous-first vs Pramana `{user_id,tenant_id}`,
> DB-resolved/multi-tenant) and their **authorization models differ at the root**
> (Mentible's deliberately flat config-allowlist tier per **ADR-020** vs Pramana's
> existing DB-backed multi-tenant 5-role RBAC). So the package exposes **verify→claims
> only**; the `Principal` mapping, roles, tenancy and entitlements stay per-app — exactly
> the "should drift, keep per-app" category of D4/D5. The **ADR-018/ADR-020 super-admin
> *pattern*** (config allowlist → derived `is_super_admin` → `require_*` dependency)
> travels as a **copyable convention built on the seam, not as shared authorization
> code** (ADR-020 D8). Sequencing is **pattern-first** (see Sequencing step 3).
**Generalises:** **ADR-012** (which extracted *one* piece of common infra — the LLM
seam — into the `wegofwd-llm` package; this ADR sets the *general policy* for the
rest of the common platform surface, plus concrete first rulings).
**Constrains / depends on:** **ADR-014** (identity = external IdP verified by JWKS;
*we build no local auth* — this is what makes "user management" a near-empty
extraction target, see Context). **ADR-001** (key discipline — the security
primitives proposed for extraction are the ones that enforce it). **ADR-018**
(system-owner principal — the *only* locally-defined principal).
**Relates:** **ADR-002** (vendoring-vs-package logic; this applies the same test to
non-LLM infra).

---

## Context

We have three products in the family that will each, independently, want the same
*kinds* of plumbing:

| Product | Role | State today |
|---|---|---|
| **Mentible** (this repo) | BYOK/managed authoring app | LLM seam shared (`wegofwd-llm`); identity designed but **not built** (ADR-014 *Proposed*); key-handling primitives built |
| **Pramana** | compliance definitions + delivery; now also generates (ADR-013) | consumes `wegofwd-llm`; managed keys via vault |
| **kathai-chithiram** | net-new (narrative/story product) | not yet started; requirements largely unknown |

The question raised: *user management and other functionality built here will be
needed by the other two — should we package it as a library used by all three?*
The framing is exactly right and important: this is **common** functionality
(the same code repeated independently in each app), **not shared** functionality
(one runtime instance several apps depend on). ADR-012 §D8 already drew this line for
the LLM seam — a **library** each app `pip install`s and runs in-process, never a
**service** they call. The same library-not-service rule governs everything here.

Two facts shape the answer:

**1. "User management" is almost entirely *not built here*, by deliberate design.**
A survey of the repo: `backend/src/auth/` is **empty**. The only account/credential-
adjacent code is `core/system_owner.py` (the ADR-018 super-admin principal) and
`core/byok_envelope.py` (per-job key encryption). ADR-014 — the account/identity
design — is **Proposed**, not implemented, and carries a *hard directive*: we build
**no** local authentication (no passwords, no OAuth/OIDC plumbing, no refresh
rotation, no auth DB); identity is an external IdP's JWT **verified statelessly via
JWKS**. So the thing the question proposes to extract — a user-management subsystem —
mostly **does not exist and is designed never to**. What remains is a *thin*
verify-token-→-principal slice plus a small set of security primitives.

**2. The rule of three.** `wegofwd-llm` (ADR-012) was the right extraction because it
came **after** two real consumers (OnDemand + Mentible) had provider code and the
interface had stopped moving. Extracting an abstraction from **zero or one**
implementation is the classic premature-abstraction trap: you harden a cross-repo
contract around today's guesses and then pay to change it in three places. For
identity specifically we have **one** design (Proposed) and **zero** running
implementations — the worst possible moment to freeze an interface.

These two facts split the common surface into "extract now" (small, stable,
security-critical, already proven) and "defer" (large, project-shaped, or unbuilt).

---

## Decision (proposed)

### D1 — Adopt the ADR-012 model as the standing policy for *all* common platform infra

Any cross-product common functionality we choose to centralise follows the
`wegofwd-llm` template, not a bespoke arrangement:

- a **library**, not a service — `pip install`ed, run **in each app's own process**
  (ADR-012 §D8). No central server, no shared runtime state, no new failure point.
- **the caller owns all state and secrets** — the library never reads `os.environ`,
  never touches a key store, a session store, or a DB. (ADR-012 §D3 for keys; the
  same rule generalises: the library is a pure function of its inputs.)
- **product-neutral and schema-agnostic** — no product's prompts, schemas, entitlement
  rules, or data model live in it (ADR-012 §D2).
- **own repo, semver tags, pinned git dependency + editable local install** (ADR-012
  §D4). Pinning is what preserves per-product decoupling (ADR-002).

This is the `wegofwd-*` package family. `wegofwd-llm` is the first member; the
decisions below add the next ones.

### D2 — Extract the security primitives **now** (low-regret, high cost-of-divergence)

Two modules already proven in this repo are identical across any BYOK/LLM product and
are *exactly* the things you do not want drifting between repos, because a drift is a
**key leak**:

| Module (here) | What it is | Why extract now |
|---|---|---|
| `core/log_redaction.py` | the ADR-001 key-scrubbing logger / `sk-ant-*`-style regex filter | a divergent copy that misses a new key prefix leaks a key. One audited implementation. |
| `core/byok_envelope.py` | per-job ephemeral-key encryption envelope (TTL, shred-after-use) | every product handling a BYOK key needs the identical discipline; re-implementing invites a weaker copy. |

These go into a small **`wegofwd-secure`** package (working name). It is tiny, stable,
dependency-light, and security-critical — the ideal early extraction. Crucially, this
**complements** ADR-012 rather than duplicating it: `wegofwd-llm` already guarantees
*it* never logs a key; `wegofwd-secure` is the consumer-side redaction filter and
at-rest envelope that ADR-012 §D3 explicitly leaves to each caller ("each consumer
keeps its own ADR-001-style log-redaction filter"). Extracting it makes "each
consumer keeps its own" mean "each consumer pins the same one."

> Each consumer still keeps its **mandatory "no key in any log line" test** (CLAUDE.md;
> ADR-012 §D3). The package ships its own copy of that test for the prefixes it knows;
> the per-app test stays as the integration gate.

### D3 — Do **not** extract user/account management — there is nothing stable to extract yet

Defer any "auth/user" package. Reasons, in order:

1. **It isn't built** — `backend/src/auth/` is empty; ADR-014 is *Proposed*.
2. **ADR-014 deliberately minimises it** — with no local auth, the candidate surface is
   a thin "verify IdP JWT via JWKS → principal" function, not a subsystem.
3. **Rule of three** — one design, zero implementations. Extracting now freezes guesses
   (IdP vendor, claim shape, principal model) that ADR-014 itself lists as *not locked*.

Build identity **here first**, for real, against ADR-014. Re-evaluate at D4's trigger.

### D4 — When identity *is* built, the extractable slice is thin and stateless — and only on the second real consumer

The forcing function is **a second product that actually needs it** (Pramana adding
authenticated users, or kathai-chithiram starting). At that point:

- **Extractable (common, stable):** stateless **JWKS fetch + cache + JWT signature/claims
  verification → a typed principal** (`{subject, email, idp, ...}`). This is the
  OnDemand-Auth0 shape ADR-014 §D1 already points at; it is pure (token in, principal
  out), holds no DB, and is identical wherever used. Candidate: **`wegofwd-identity`**.
  The **ADR-018 super-admin principal** pattern (a config-based principal, not an
  account) may join it if a second product needs the same admin concept.
- **NOT extractable (project-shaped, keep per-app):** the **per-provider credential
  set** and its custody rules (ADR-014 §D-credential-set — device-local / synced-e2e /
  managed-vault), **billing/entitlement _policy_** (Mentible's metered LLM allowance +
  BYOK vs Pramana's compliance delivery vs kathai-chithiram's unknown model — plans,
  allowances, what-a-plan-grants, and the entitlement/usage DB rows), the **sync record**
  (ADR-014 §D8), and every **data model**. These differ per product and will fight a
  shared abstraction — they are the "content that *should* drift" of ADR-002, not the
  "infra that must not" of ADR-012.
  > **Refinement (2026-06-30 amendment).** This bars the billing *policy*, **not** the
  > billing *mechanism*. The managed-billing mechanism (vault access, token→cost metering,
  > webhook-verify → generic entitlement, the cap engine) *is* identical everywhere and is
  > the **`wegofwd-billing`** candidate — built in Mentible first, extracted on the second
  > consumer (see the header amendment + Sequencing step 4).

The boundary, stated once: **`wegofwd-identity` answers "who is this caller?"; each app
answers "what may they do and what do we store for them?"**

### D5 — The vendoring-vs-package test still applies per-candidate

ADR-002's test — *does this artifact want to drift per product (vendor it) or be
identical everywhere (package it)?* — is the deciding question for every future
candidate, not just these. Security primitives and token-verification are "identical
everywhere" → package. Prompts, schemas, entitlement **policy**, UI → "should drift" →
stays per-app (vendored where shared at all). _Note (2026-06-30):_ "entitlement policy"
here means plans/allowances/grants/DB rows — the billing **mechanism** (vault access,
metering/cost, webhook-verify→entitlement, cap engine) is on the package side of this
line (`wegofwd-billing`). When in doubt, **copy first, extract on the third instance** —
a wrong abstraction costs more than a duplicated file.

---

## Sequencing

1. **Now:** create **`wegofwd-secure`** from `core/log_redaction.py` +
   `core/byok_envelope.py` (+ their tests). Mentible is the reference consumer:
   replace the local modules with the pinned dependency; keep the mandatory per-app
   redaction test. Tag `v0.1.0`. *(Low-risk: these modules are stable and have no
   product specifics.)*
2. **Here, next:** build identity in Mentible against ADR-014 (JWKS verify → principal),
   **in-repo**, no premature package. This is the first implementation.
3. **Second consumer reached — pattern-first (amended 2026-06-19).** The trigger is met
   (Pramana + Mentible both have JWKS auth). Order:
   1. Build Mentible's super-admin gate **in-repo** (ADR-020 ticket #1), but code the
      verifier to return a **`VerifiedToken{sub, email, issuer, raw_claims}`** so the
      extractable seam already has its final *shape*. Map `VerifiedToken → Principal`
      and derive `is_super_admin` in app code.
   2. **Extract `wegofwd-identity`** (verify→claims only) when a consumer is actually
      wired to it — fold Mentible + Pramana onto the package then, so the API is frozen
      against two real callers, not one-and-a-half. Tag `v0.1.0`; its own ADR-012-style
      record.
   3. The `Principal` mapping, role/tenancy model, entitlements, credential-set and
      data-model **stay per-app**; the super-admin gate travels as a copyable pattern
      (ADR-020 D8), not shared authz code.
4. **`wegofwd-billing` — build-first, extract-on-second-consumer (added 2026-06-30).**
   1. Build managed billing **in Mentible, in-repo**, against ADR-005 (D6) +
      `docs/MANAGED_BILLING_BUILD_PLAN.md`. **Factor the *mechanism* behind a clean seam**
      from day one — vault access, `meter(usage)→cost`, `verify_webhook(payload)→
      entitlement`, `enforce(policy, usage)→decision` — so the extractable surface already
      has its final *shape* (the same trick used for `VerifiedToken` in step 3).
   2. Keep **plans, allowances, entitlement/usage DB rows, and UX in app code** (per-app
      policy, D4/D5).
   3. **Extract `wegofwd-billing`** (mechanism only) when a second consumer actually wires
      to it — **Pramana** is the likely trigger (it already does managed-vault generation).
      Fold Mentible + that consumer onto the package then, so the API is frozen against two
      real callers. Tag `v0.1.0`; its own ADR-012-style record. **No** cross-product
      wallet / shared service (D1 holds) unless a *separate* decision revisits that.
5. **Each step is its own ADR-012-style record** (or an amendment here) noting what
   moved and what stayed.

---

## Alternatives considered

| Approach | Verdict |
|---|---|
| **Extract a full "user management" / auth package now** | **Rejected.** Nothing stable to extract — `auth/` is empty, ADR-014 is Proposed and deliberately thin. Premature abstraction from zero implementations; freezes unlocked decisions. |
| **Build a central auth/identity *service* all three call** | **Rejected** for the same reasons ADR-012 §D8 rejected a central LLM service: a new 24/7 server to run/secure, a single point of failure for all three apps, and — worst — a central honeypot of identity/keys that erodes ADR-001 and ADR-014's BYOK promise. Library-not-service holds. |
| **Keep copy-pasting common code per repo indefinitely** | **Rejected for the security primitives** (D2) — divergence there means a leaked key; cost-of-drift is too high. **Accepted as the interim** for identity until D4's trigger — duplication is the correct cost while the interface is still moving. |
| **One big `wegofwd-core` kitchen-sink package** | **Rejected.** Couples unrelated release cadences (a redaction fix shouldn't force an identity bump) and bloats every consumer's dependency surface. Prefer small, single-purpose siblings (`wegofwd-llm`, `wegofwd-secure`, later `wegofwd-identity`). |

---

## Open questions

- **Package family naming.** `wegofwd-secure` / `wegofwd-identity` are working titles,
  consistent with the org-scoped, product-neutral naming ADR-012 settled on. Confirm
  before tagging `v0.1.0`.
- **`wegofwd-secure` ↔ `wegofwd-llm` boundary.** Both touch key-safety. Confirm the
  split: `wegofwd-llm` guarantees *it* never emits a key; `wegofwd-secure` is the
  app-side redaction filter + at-rest envelope. They should not overlap.
- **kathai-chithiram's actual requirements.** Its identity/entitlement needs are unknown;
  it may be the second consumer that triggers D4, or it may not need accounts at all.
  Do not design `wegofwd-identity` to its hypothetical shape — wait for the real ask.
- **Does Pramana need `wegofwd-secure` today?** If its managed-vault path handles raw
  provider keys, yes (it should pin the same envelope/redaction). Confirm during the D2
  extraction.
- **Repo location / release ownership** — same governance question ADR-012 left open;
  a single owner per package keeps each contract coherent.

---

## Consequences

**Positive:** one audited implementation of the highest-risk common code (key redaction,
key envelope) instead of three drifting copies — the cost-of-divergence there is a leaked
key, so this is the most valuable thing to centralise and the cheapest to do (small,
stable). The general policy (D1, D5) gives a repeatable test for every future candidate,
so "should this be a library?" stops being relitigated. Deferring identity (D3/D4) avoids
hardening a Proposed design into a cross-repo contract before it has met a single real
consumer. ADR-002's intent is preserved: infra-that-must-not-drift gets packaged;
content/policy-that-should-drift stays per-app.

**Negative:** another small repo + release process now (`wegofwd-secure`); identity code
is knowingly duplicated between Mentible and the second product *until* D4 triggers
(accepted cost); and the discipline only pays off if we actually apply D5's test
per-candidate rather than reflexively packaging or reflexively copying.

---

## References

- ADR-012 — Shared LLM seam package; the template this generalises (library-not-service,
  caller-owns-secrets, schema-agnostic, semver/git-pin). `wegofwd-llm` is family member #1.
- ADR-014 — User accounts & per-provider credential set (*Proposed*); the "no local auth,
  JWKS-verify only" directive that makes user-management a near-empty extraction target;
  the credential-set/entitlement parts that stay per-app.
- ADR-001 — BYOK key discipline; the rule `wegofwd-secure` (D2) enforces across products.
- ADR-018 — System-owner principal; the only locally-defined principal, a candidate to
  ride along in `wegofwd-identity` if a second product needs it.
- ADR-002 — Repo structure & vendoring; the drift-vs-identical test applied per-candidate (D5).
- `backend/src/core/log_redaction.py`, `backend/src/core/byok_envelope.py` — the D2
  extraction candidates. `backend/src/auth/` — empty, per D3.
