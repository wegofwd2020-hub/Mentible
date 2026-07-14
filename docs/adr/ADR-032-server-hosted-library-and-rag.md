# ADR-032 — Server-hosted library + hosted RAG + storage tiers (the hybrid hosted account)

**Status:** Proposed — 2026-07-12 (the §5 open decisions of the pre-ADR brief are now
resolved; see D1–D10). **Amended 2026-07-14 (Siva) — see D11–D15:** the server ingests
**public-domain works only** (personal uploads never leave the device); the PD corpus is
**shared, global, and deduplicated** (embedded once, serving every user, outside per-user
storage caps); ingestion **fetches from the vetted source itself** and never accepts client
bytes (corpus-poisoning); and grounding over that corpus is **free-tier**, not gated on
managed billing. Design-only; the *paid hosted* tier remains gated on the managed-billing
launch.
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

## Amendment — 2026-07-14 (Siva): the shared public-domain corpus

Three decisions taken 2026-07-14 narrow the content scope, change the corpus *shape*, and
un-gate part of the tier. They **amend D2, D4, D7, D9, and D10**; the rest of the ADR
stands.

### D11 — The server ingests **public-domain works only**. Personal uploads never leave the device (**amends D2, D7**)

D2(b) — "the user's **own uploads**" — is **removed from the server's content scope**. The
server-hosted corpus is **public-domain works from sources Mentible has vetted**, and
nothing else. A book the user brings from anywhere else (their own PDF/EPUB, a
non-curated feed) lives **only in their library, on their device**, and is grounded by the
**device-local** path (ADR-029) or not at all.

Consequences, deliberately accepted:
- The **ToS rights-representation + indemnification** clause (D7) is no longer needed for
  uploads — we host nothing a user hands us.
- The **DMCA surface shrinks to near zero**: we host only works nobody owns. The
  safe-harbor mechanics of D7 remain prudent, but they stop being the load-bearing shield.
- The paid tier loses "my own files, everywhere" as a selling point. That is a real product
  cost, taken knowingly.

### D12 — The trust anchor is the **source**, not the book's claim

Ingestion is gated on **the book coming from a source on Mentible's curated allowlist**
(Project Gutenberg today), **never** on a book *claiming* to be public domain.

"Free / non-copyrighted" is not a property we can verify. The only evidence available for
an arbitrary book is metadata from a feed we do not control — and **feed XML is hostile
input** (ADR-028). A pirated EPUB can simply assert `Rights: Public domain`. Trusting that
string would put copyrighted content into a corpus that serves **every user**. The
allowlisted *source* is verifiable and is **our** decision, not an attacker's. Widening the
corpus therefore means **vetting another repo**, an owner action — the same stewardship
pattern as the starter list (ADR-018/020).

### D13 — The PD corpus is **shared and global**, deduplicated, outside per-user storage (**amends D4**)

A public-domain work is **identical for every user**. It is therefore embedded **once,
globally**, keyed by a **stable global book identity** (e.g. `gutenberg:2701`), and served
to all users. A user's "library" is a **selection of book IDs**, not a copy of the corpus.

- **Not** per-account content ⇒ **no per-user isolation problem**, so backend rule #4
  ("single-tenant by user, no RLS") **survives intact** — there is no private per-user
  content in the vector store to isolate.
- **Does not count against any storage cap** (D4) — the user is not storing Moby Dick; we
  are, once, for everyone.
- **Warm on arrival:** a new user importing a book we have already ingested gets grounded
  generation **instantly**, with no per-user ingestion wait. The corpus is a compounding
  asset that ships warm.
- Cost collapses from *once per user per book* to *once per book, ever*.

### D14 — Ingestion **fetches from the source**; it never accepts bytes from a client

**The client's import is a demand signal, not a content pipe.** On first import of a book
we have not ingested, the device sends only its **global book ID**; the **server fetches
that book from the vetted source itself** and embeds it.

The server must **never** accept book bytes from a client. The corpus is **shared across
all users**, so anything admitted to it serves everybody — a client-supplied upload keyed
`gutenberg:2701` is a **corpus-poisoning** vector: a malicious user could inject
copyrighted text (making us a host of it) or content crafted to steer other users'
generations. Fetching from the allowlisted source ourselves is both the security control
and the cleaner legal footing (the server fetches a source **we** curated, never one a
**user** named — the distinction D7 already draws).

Ingestion is therefore **demand-driven but server-executed**: cost tracks what users
actually read, and the corpus grows toward real demand rather than pre-embedding 75k books
nobody opens.

### D15 — Grounding over the shared PD corpus is **free-tier** (**amends D9, D10**)

Retrieval over the shared PD corpus is **not** gated on the managed-billing launch and does
**not** require a subscription. It costs us almost nothing (embedded once, shared), and it
is the **warm-start hook**: it shows a new user what Mentible *is* — generation grounded in
real books — before they pay for anything. The paid hosted tier then sells **their own
library, hosted and cross-device**, not access to public books.

**This breaks D10's abuse argument** ("the hosted tier is paid, which structurally blunts
Sybil/abuse"). Free-tier retrieval must therefore carry its own controls:
- **Account-gated** (accounts exist at MVP — ADR-005), never anonymous.
- **Per-account rate limits + a query ceiling** on retrieval and query-embedding spend.
- Query embeddings are tiny, but they are **our** managed-key spend on a **free** user —
  so they must be metered like any other managed spend (ADR-016), not left unbounded.

### Open questions from this amendment

- **OQ-A1 — Authored books (D2c).** D2's scope was PD downloads + user uploads +
  **Mentible-authored books**. D11 removes uploads but is **silent on (c)** — the user's
  *own writing*, in our format, which cloud library sync already contemplates holding
  (ADR-014, opt-in, zero-knowledge). Does the server hold and index authored books? If yes,
  server-side RAG over them **cannot be zero-knowledge** (D6's tension, now applied to the
  user's own manuscript). **Owner decision; not resolved here.**
- **OQ-A2 — Global book identity.** The dedup key (`gutenberg:2701`) must be stable,
  collision-free across repos, and derivable from feed metadata we already parse. Needs a
  concrete scheme before build.
- **OQ-A3 — Retrieval reveals interest.** A retrieval query names the book IDs to search,
  so the backend learns what a user is writing against. Mitigable (IDs per request,
  persist nothing), but it is a **new server-visible signal** and must be disclosed
  honestly (D6) rather than quietly acquired — it partially erodes ADR-028 D6
  ("preferences, not profiles") for free-tier users, who previously gave us nothing.
- **OQ-A4 — What the paid tier now sells.** With uploads device-local (D11) and the PD
  corpus free (D15), the hosted tier's value is narrowed to hosting/syncing the user's
  **own** material. Worth re-checking that it still justifies its price and its D7 legal
  burden.

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
