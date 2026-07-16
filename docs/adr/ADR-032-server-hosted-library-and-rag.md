# ADR-032 — Server-hosted library + hosted RAG + storage tiers (the hybrid hosted account)

**Status:** Rejected — 2026-07-15 (superseded by ADR-033). Originally Proposed 2026-07-12
(§5 resolved; see D1–D10). Design-only; never implemented.

> **This decision was rejected.** The document is retained as the record of the broad
> hosted shape that was considered and narrowed to a per-user *private* hosted tier — see
> **ADR-033**. Its reasoning has archival value; the body below is unchanged.
**Decision-maker:** Sivakumar Mambakkam
**Amends:** ADR-028 D2/D3/D6 (device-local / per-device / neutral-conduit /
preferences-not-profiles — now the **free-tier** posture, with an opt-in hosted tier
beside it), ADR-014 D8 (data-minimization / device-local default — the hosted tier holds
readable content), ADR-001 (no server-side key custody — the hosted tier's RAG runs on
**managed** keys, never a user's). **Reshapes:** ADR-029 and ADR-030 (both become
**dual-mode** — device-local free + hosted paid; see D8). **Relates to:** ADR-005 (managed
vault), ADR-031 (the `Plan`/entitlement machinery the storage tier reuses), ADR-016/013
(managed billing + metering — the launch gate), ADR-022 (deletion of derived data).
**Companion:** `docs/proposals/2026-07-12-server-hosted-library-and-rag.md` — the design
brief, including the full **copyright / DMCA legal analysis** condensed in D7 here.

---

## Context

Authoring + the ADR-029 RAG were designed **device-local** (ADR-028 D3): downloads and the
index live on the phone/tablet. Building a RAG over a sizeable personal library on a phone
pressures device storage (books + vector store), and ties the AI functionality to one
device. The product owner wants the library, index, and references to **follow the account
across devices** — the user gets the AI functionality **without being tied to one device**.

That is a **reversal of ADR-028's core promise**, not a tuning of ADR-029. This ADR takes
it as an **opt-in, paid, hybrid** tier so the reversal is a deliberate upgrade, not a
wholesale loss of the device-local moat. The pre-ADR brief settled the content-scope and
the copyright analysis; this ADR resolves the remaining architecture (§5) and records the
whole decision.

---

## Decision

### D1 — Hybrid: device-local free baseline + opt-in hosted account (paid)

**ADR-028 device-local stays the free/anonymous baseline, unchanged.** The **hosted
account** — library + RAG on our servers — is an **opt-in unlock tied to subscription**.
The reversal is therefore opt-in per user, never wholesale; the anonymous/zero-account mode
(the demo's mode) and the privacy moat remain the free tier.

### D2 — What lives on the server (content scope)

Server-hosted corpus = **(a)** public-domain feed downloads (Gutenberg, PD Internet
Archive), **(b)** the user's **own uploads**, **(c)** Mentible-authored books. Everything
else stays device-local: **copyrighted-but-free feed downloads** and **user-added
third-party repo content** live on the device; the server holds only their **metadata /
link**, and **never fetches or stores a user-named repo's files** (the highest-exposure
path — D7).

### D3 — Hosted RAG compute: server lexical first, managed-key semantic later

- **Phase 1 — server lexical full-text search.** No LLM, no keys; ships the moment hosting
  exists and delivers "search my library across devices" immediately.
- **Phase 2 — semantic embeddings on managed keys**, metered, **gated on the
  managed-billing launch**. A user's key is **never** held server-side (ADR-001); the
  hosted tier is paid, so managed keys are the natural and only compute source. On-device
  BYOK semantic (ADR-029 Phase 2) remains the **free-tier** path.

### D4 — Storage is a `Plan` axis; tiers are plans

Add a **storage cap (GB)** to the existing `Plan` (the same object ADR-031 extends with a
feature axis). The base paid tier carries a default allowance; higher plans carry more.
Enforced at upload / download-to-server and accounted like spend. **Tiers are just plans** —
no new billing system; it reuses the built entitlement/metering machinery (ADR-031, ADR-016
Phase 6).

### D5 — Sync: server is source of truth; thin-client query/stream

The library + index live server-side; a device **queries the server** for search/references
and **streams** content on demand. Multi-device is trivial (every device sees the same
state); there is **no local replication and no conflict handling**. Hosted-RAG offline needs
a connection — acceptable, because the **free device-local tier works fully offline**.
Device-side caching of recent items for partial offline is a **v2 refinement** (open Q).

### D6 — Privacy: not zero-knowledge, but opt-in + strong data rights

Server-side RAG **must read content** to index/embed it, so the hosted tier **cannot be
zero-knowledge** (unlike ADR-014's default). The mitigation posture we commit to:

- **Opt-in only** (via subscription) — never automatic.
- **Encryption at rest.**
- **Deletion purges** the library **and** its index within the documented window (extends
  ADR-022; amends ADR-014 D8) — deleting the account, a book, or turning the hosted tier
  off removes the server copy + derived index.
- **Export on request.**
- **Use-limited** to serving the user's **own** RAG — **no third-party sharing, no ad
  profiling**, no cross-user use.
- **Honest messaging:** "your hosted library lives with us to power cross-device AI; the
  free tier stays on your device."

The **free device-local tier remains zero-knowledge** (ADR-014 default).

### D7 — Copyright: server hosts only PD + the user's own uploads; disclaimer + DMCA, not disclaimer alone

Hosting third-party files server-side loses ADR-028's neutral-conduit protection, so:

- The server hosts **only public-domain works** (no rightsholder) **and the user's own
  uploads** (rights-represented). Copyrighted-free feed content and user-named repos stay
  device-local (D2).
- A **ToS rights-representation + indemnification** clause governs uploads (necessary — it
  binds the user, not the rightsholder).
- **DMCA safe-harbor mechanics are mandatory** and are the actual shield against
  rightsholders: registered DMCA agent, notice-and-takedown, a repeat-infringer policy, no
  actual knowledge / no inducement. **Disclaimer + DMCA together**, not disclaimer alone.
- The server **never fetches a user-named repo** (weakest legal footing).
- **A legal review of the ToS + DMCA setup is a launch-gating prerequisite** before any
  hosting ships. (Full analysis in the companion brief §4. *This is orientation, not legal
  advice.*)

### D8 — ADR-029 / ADR-030 become dual-mode

- **ADR-029 (references/RAG):** keeps its **device-local** mode as the free tier; gains a
  **hosted** mode (server FTS now, managed-key embeddings Phase 2) for the paid tier.
- **ADR-030 (currency agent):** the **author-side BYOK** check remains the free/BYOK path;
  the **scheduled/background** form (already gated on managed billing in ADR-030 D4)
  **lives on the hosted tier**.

Both ADRs get an "amended by ADR-032" note; their device-local designs are **retained**,
not replaced.

### D9 — Gating: the whole hosted tier depends on the managed-billing launch

Managed keys (D3), metering, and storage plans (D4) all live in ADR-016/013's
managed-billing machinery (built, off). The hosted tier therefore **ships with the
managed-billing launch**, not before. The free device-local tier needs none of it and is
unaffected.

### D10 — Abuse & cost posture

The hosted tier is **paid**, which structurally blunts Sybil/abuse (no free hosting to
farm). Per-plan **storage caps** (D4) and the existing **per-account spend ceiling**
(ADR-005 O7) bound infra and token cost. Managed embeddings comp only paid providers
(no free-tier Gemini — trains on data).

---

## Open questions

1. **Embedding provider/model + vector-store infra** for Phase-2 hosted semantic (via
   `wegofwd-llm`); chunking; on-server vector store choice and bounds.
2. **Offline cache (D5 v2)** — which items cache to the device, invalidation, partial-offline
   RAG behavior.
3. **Migration flow** — moving an existing **device-local** library into a hosted account
   (upload of PD works + user files; what's eligible per D2/D7).
4. **Storage-tier pricing** — the actual GB allowances per plan vs infra cost (ties to
   ADR-031 plan catalogue).
5. **ToS + DMCA exact wording** — legal-drafted (D7); the launch gate.
6. **FTS engine on the server** (Postgres FTS vs a dedicated search index) and how hosted
   lexical results interleave with metadata-tier (undownloaded) entries.

---

## Scope — what this ADR is *not*

- **Not** a change to the **free tier** — ADR-028 device-local / zero-knowledge is unchanged
  for free/anonymous users.
- **Not** server-side **BYOK** key custody — hosted RAG runs on **managed** keys (D3, ADR-001).
- **Not** hosting of **copyrighted** third-party files — PD + user-own-uploads only (D2/D7).
- **Not** a device-sync/replication system — server is source of truth (D5).
- **Not** shippable before **managed billing** (D9).
- **Not** the legal opinion itself — D7 records the posture; counsel drafts/clears it.

---

## Consequences

**Positive:** device-unburdened, cross-device AI; the device-load concern behind ADR-029
disappears for hosted users; every current moat survives as the free tier; storage becomes a
clean monetization axis on machinery already built; managed billing is the single gate for
keys + metering + storage.

**Negative / cost:** real infra (stored bytes + vector store + server FTS/embeddings);
a genuine privacy/GDPR footprint (readable user content — D6) with deletion/export
obligations; a **legal review** gates launch (D7); the hosted tier can't ship until managed
billing is on (D9).

**Migration:** additive and opt-in. Existing users stay device-local until they opt into a
hosted plan; a migration/upload flow (open Q3) moves eligible content up. Anonymous /
device-local remains the zero-account baseline.

---

## Staged plan (post-acceptance, with managed billing)

1. Storage axis on `Plan` + per-account storage accounting/enforcement (D4).
2. Hosted content store: PD-works + user-upload ingestion, with the D2/D7 eligibility gate
   (no copyrighted feed content, no repo-fetch).
3. Server **lexical FTS** index over the hosted corpus + the hosted reference/query surface
   (D3 Phase 1, D5 thin-client).
4. Privacy plumbing: encryption at rest, deletion purges library+index, export (D6).
5. ToS rights-rep/indemnification + DMCA agent/takedown/repeat-infringer — **legal review
   gate** (D7).
6. Dual-mode wiring of ADR-029 (hosted FTS) and ADR-030 (scheduled form on hosted) (D8).
7. *(Phase 2)* managed-key semantic embeddings + on-server vector store, metered (D3, Q1).
8. *(v2)* device offline cache (D5, Q2); migration/upload flow (Q3).

## Follow-up tickets

- **SBQ-HOST-001** — `Plan` storage axis + storage accounting/enforcement (staged 1).
- **SBQ-HOST-002** — hosted content store + PD/upload ingestion with the D2/D7 gate (staged 2).
- **SBQ-HOST-003** — server lexical FTS + hosted reference/query surface (staged 3).
- **SBQ-HOST-004** — hosted-tier privacy: encryption, deletion-purge, export (staged 4).
- **SBQ-HOST-005** — ToS + DMCA setup (legal-gated) (staged 5).
- **SBQ-HOST-006** — ADR-029/030 dual-mode wiring (staged 6).
- *(carried)* Phase-2 hosted embeddings + vector store (Q1); offline cache (Q2); migration flow (Q3).
