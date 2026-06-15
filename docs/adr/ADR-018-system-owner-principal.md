# ADR-018 — System-owner (super-admin) principal: default application & library ownership

**Status:** Proposed — 2026-06-15
**Decision-maker:** Sivakumar Mambakkam
**Amends:** the `CLAUDE.md` non-negotiable **"Single-tenant by user, no RLS… one
user account = one isolated library"** — introduces exactly **one** privileged
principal _above_ the flat user model (it does **not** reintroduce per-tenant RLS;
see D3). **Extends:** **ADR-014** (flat user accounts via external IdP) with a
**non-IdP** system principal. **Relates:** **ADR-017** (default shareable library —
the system-owner is its owner/publisher), **ADR-005** (managed-key vault — default
content is generated under owner-held managed keys, not a user's BYOK), **ADR-001**
(key/secret no-log discipline now also covers the owner credential).
**Implemented by:** PR _TBD_ — this ADR lands the decision; config schema, owner
auth, and the publishing gate are follow-up tickets.

---

## Context

Mentible's identity model is deliberately **flat**: ADR-014 makes every account an
equal, self-service user verified by an external IdP, anonymous-first, with no
roles and no per-tenant isolation beyond "one user = one isolated library"
(`CLAUDE.md`). That was correct for a BYOK demo.

But two things have no owner in that model:

1. **The default shareable library (ADR-017).** The bundled books carry a
   `publisher: "Mentible"` _string_ in metadata, but no **principal** owns them, and
   nothing authorises promoting a book from `draft` to a shipped `published` default.
   The ADR-017 seeder "skips drafts" — but _who_ flips the flag is undefined.
2. **The application itself.** There is no system owner: no principal that holds the
   managed-key vault (ADR-005), curates what ships, or performs privileged operations
   the flat user model has no room for.

We need a **single system-owner (super-admin) principal** that owns default
application + library and can operate them — _without_ eroding the flat user model,
the BYOK trust promise, or ADR-014's "we don't read your content."

**Decisions taken (2026-06-15):** owner **and** operator (one principal, both
roles); built at **MVP**; identified as a **separate, config-defined system
principal** (not an IdP role claim).

## Decision (proposed)

### D1 — One system-owner principal, defined out-of-band (config), not via the user IdP

There is **exactly one** system-owner, bootstrapped from configuration
(`pydantic-settings`, env only — consistent with "all secrets from env vars; no
hardcoded defaults; fail fast at startup"): an owner identifier plus an owner
**auth secret / signing key**. It is **not** an account row and **not** a role claim
on the ADR-014 IdP. This keeps RBAC out of the user identity model — the user side
stays flat; the owner is a separate, singular principal beside it.

> Rationale for non-IdP: a role tier on the user IdP would pull RBAC, privileged
> sessions, and "is this caller an admin?" checks into every user path. A single
> config principal keeps the privileged surface tiny and auditable.

### D2 — The system-owner owns and publishes the default library

The owner is the **publisher of record** and provenance owner of the ADR-017
default library. The `publisher: "Mentible"` metadata is the owner's _display_
identity; the **owner principal** is the authority behind it. Concretely, the owner
is the **only** principal authorised to **promote a book `draft → published`** into
the shipped default set. ADR-017's "seeder skips drafts" now has an owner-gated
publish action behind the `published` flag.

### D3 — "Application ownership" ≠ multi-tenancy; the flat user model is unchanged

This is the load-bearing boundary. The owner is **one global principal**, not a new
**tenant axis**:

- Users stay flat: **one user = one isolated library, no per-user RLS, no
  `school_id` dance.** The non-negotiable holds _for users_.
- The owner sits **above** that as a singular global identity that owns _default /
  shipped_ assets and operational controls — it is not "tenant zero".
- The owner **cannot read user libraries or user-generated content** (preserves
  ADR-014 D8 data minimisation and the BYOK promise). Owner powers are over
  **default/shipped assets and ops**, never user-owned data.

So we add _one privileged principal_, not multi-tenancy. The `CLAUDE.md`
non-negotiable is **narrowed** ("flat _for users_; one global owner above"), not
discarded.

### D4 — Default content is generated under owner-held managed keys, never a user's BYOK

Producing the default library (e.g. generating the cert guide's lessons, issue
#113) runs under the **owner's managed credentials** (ADR-005 managed vault), so
shipping default content never depends on, touches, or bills a user's BYOK key.
This makes the owner the natural holder of the managed-key vault.

### D5 — Owner authentication & action surface

Owner-only operations (publish/curate, vault ops) require the owner credential from
D1. At MVP the owner acts **out-of-band** — via admin tooling / a CLI / a signed
manifest in the build pipeline — **not** an in-app login (there is no hosted library
catalog to administer in-app yet; ADR-017 ships committed files). An in-app or
backend admin surface can come with the hosted catalog (v1.1+).

### D6 — Audit & blast radius

Owner actions (publish, promote, vault access) are **logged** (actor = owner,
action, target, timestamp) — _without_ secrets. The owner credential follows the
same **no-log / never-persisted-in-the-clear** discipline as provider keys
(ADR-001). Compromise of the owner principal is high-impact, so its secret is
held/rotated like a production signing key, separate from user-facing config.

## Open decisions (for the decision-maker)

- **O1 — Owner action surface at MVP:** standalone admin **CLI** vs a **signed
  manifest** the build verifies vs a hidden in-app admin screen. (Lean: CLI /
  signed manifest — no in-app admin until the hosted catalog exists.)
- **O2 — One owner forever, or an owner-managed publisher allowlist later?** Start
  with exactly one; revisit if multiple curators are needed.
- **O3 — Owner ↔ managed-vault relationship (ADR-005):** is the owner principal the
  _holder_ of the managed vault, or a separate ops identity that _authorises_ vault
  use? (Lean: holder, at least at MVP.)
- **O4 — Where the published default catalog lives once the backend library exists
  (v1.1+):** an owner-owned global table vs the committed repo files of today
  (ADR-017). Until then, "publish" is a repo/build act by the owner.
- **O5 — Promotion integrity:** should `published` state be **cryptographically
  signed** by the owner key (so a tampered `manifest.json` can't ship a book as a
  default), or is repo review sufficient at MVP?

## Consequences

**Positive:** the default library finally has an owner and a real publish gate;
default content generation is cleanly attributed to the owner and never entangles a
user's BYOK key; the privileged surface is a single, auditable, config-defined
principal rather than an RBAC tier; the flat user model and BYOK promise are
preserved intact.

**Negative / risk:** this is the **first privileged principal** in a deliberately
flat product — it narrows a stated non-negotiable and must be guarded so it never
grows into a general admin/RBAC system or gains read access to user content. A
high-value owner secret now exists (blast radius if leaked). Owner tooling is new
surface to build and secure.

**Migration:** additive. Today's committed-files default library (ADR-017) is
**reframed** as "owned and published by the system-owner from the repo"; the seeder
and on-device behaviour are unchanged. Anonymous / device-local remains the
zero-account baseline.

## Scope — what this ADR is _not_

Not an RBAC system, not multi-tenancy, not a per-user admin console, not the
managed-billing/metering design (ADR-005 follow-up). It fixes **who owns and may
publish the default application + library, and how that principal is identified** —
the items in Open Decisions are left to the decision-maker.

## Follow-up tickets

1. Owner principal in config (`SYSTEM_OWNER_*`), fail-fast validation (D1)
2. Owner-gated `draft → published` promotion for the default library (D2; ties to
   ADR-017 + issue #113)
3. Owner as managed-vault holder; default-content generation under owner keys (D4)
4. Owner action audit logging + secret-handling discipline (D6)
5. Reconcile `CLAUDE.md` (the "single-tenant, no RLS" non-negotiable + decision
   tables) once this ADR is Accepted
