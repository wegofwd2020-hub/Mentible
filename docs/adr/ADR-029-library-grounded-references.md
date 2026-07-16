# ADR-029 — Library-grounded references: topic → citations from the personal shelf

**Status:** Proposed — 2026-07-10 · **amended by ADR-033 (2026-07-15):** the device-local
design below is the **free tier**; the hosted mode is the per-user **private** paid tier
(server FTS now, managed-key embeddings Phase 2) — see **ADR-033** (ADR-032's broad hosted
shape was rejected). This ADR stays *Proposed*; nothing here is promoted or built.
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-028 (Open Shelves — downloads create the external half of the
corpus; rights strings and source refs come from feed metadata), ADR-015
(content-trust manifest — inserted references become manifest citations), ADR-001
(BYOK discipline — Phase 2 embeddings spend the author's key, visibly), ADR-014
(local-first — the index is device-local derived data), ADR-004 (this is the first
feature that crosses from the **reader** side into the **authoring** side), ADR-012/019
(library-not-service seam instinct), ADR-022 (derived data must be deletable).
**Companion:** `docs/specs/open-shelves-spec.md` §2 (device-side content posture).

---

## Context

Authoring in Mentible is grounded in the **scoped query** — but not in any *corpus*.
An author writing about a topic they have twenty books on gets no help from those
books. Meanwhile ADR-028 just gave the device a shelf of downloaded, provenance-
tagged EPUB/PDF content sitting right next to the authored books.

The gap: **give Mentible a topic, get back references from the author's own
library** — passages and works to ground, cite, or quote. In industry terms this is
retrieval (RAG); in Mentible terms it is the scoping IP acquiring a corpus. The
differentiator is not the mechanism but the substrate: retrieval that runs
**on-device, over a corpus the user chose**, with zero server-side profile — the
opposite of the upload-your-documents-to-our-cloud default.

The constraints are inherited, not invented: only content that **exists as full
text on the device** can be deeply searched (ADR-028: downloads are EPUB/PDF/audio;
video never persists), keys never live server-side (ADR-001), and reading interests
never become server-visible (ADR-028 D6). Audio can download but is opaque without
transcription — a real per-hour BYOK cost.

---

## Decision (proposed)

### D1 — The corpus is the **device shelf**, tiered by what's actually present

Retrieval runs over: **(a)** authored books (always full-text — we have `book.json`),
and **(b)** **downloaded** Open Shelves EPUB/PDF. Feed entries that are *not*
downloaded participate at **metadata level only** (title/description/category match)
and are surfaced with a **"download to make searchable"** affordance — honest about
the tier, and a natural reason to download. **Video is never in the corpus**
(streaming-only by ADR-028 D2). **Audio is parked** (D5).

### D2 — **Phase 1 is lexical, on-device, free**; Phase 2 is **opt-in BYOK semantic**

- **Phase 1 (MVP): full-text search** (SQLite-FTS-class) built and queried entirely
  on-device. No network, no token cost, works offline, and answers the core ask —
  "topic → where do my books discuss this" — at real quality.
- **Phase 2 (own switch, later): semantic retrieval** via embeddings on the
  author's **BYOK** provider. Strictly **opt-in with plain disclosure**: enabling
  it sends book excerpts to the chosen provider and costs tokens. Never a silent
  upgrade; Phase 1 remains the default forever.

### D3 — The index is **per-device, derived, disposable**

The index is derived data: **rebuildable from local content, deletable on demand,
never synced or uploaded**, and it dies with the app data (ADR-022 spirit). It
mirrors ADR-028 D3's download semantics — a second device builds its own index over
its own downloads. Index size is capped and surfaced alongside the Downloads view's
storage accounting. Deleting a downloaded book removes its index entries.

### D4 — Every reference carries **provenance and rights**; insertion is a **manifest citation**

A retrieved reference renders with its **source ref and rights string** (from
ADR-028's entry record for external works; from our own metadata for authored
works). Inserting a reference into a draft creates a **structured citation object**
that flows into the **Content Trust Manifest** — the book can prove what it leaned
on. Consistent with the neutral-conduit stance (ADR-028 D4): the tool **surfaces**
rights, it never adjudicates them — no "safe to quote" implication, ever; quoting
judgment stays with the author. Retrieval UI shows short excerpts; it is a finding
aid, not a reproduction surface.

### D5 — **Audio indexing is explicitly deferred**

Referencing *inside* audio requires transcription — a per-hour BYOK cost with real
quality variance. Rather than let it ride in by implication, it is **parked** with
its own future decision (opt-in, per-file, cost shown up front). Audio entries
participate at metadata tier meanwhile.

### D6 — The authoring surface is a **reference panel**, engine-side logic stays a **library**

In the authoring flow: enter/select a topic → ranked references (work, location,
excerpt, rights) → insert-as-citation. Retrieval logic lives product-neutral behind
the ADR-012/019-style seam (index build / query / cite), with the app as a thin
client — PRAMANA-shaped reuse is plausible and costs nothing extra to preserve.

---

## Open questions

1. **Index engine in RN/Expo** — SQLite FTS5 availability via the current stack
   (expo-sqlite capabilities), else a JS-side inverted index; spike decides.
2. **Excerpt policy** — retrieval-display excerpt length, and *insertion* excerpt
   limits for non-public-domain downloads; how the rights string modulates the UI
   (display-only vs quotable), given we surface rather than adjudicate (D4).
3. **Ranking** — Phase 1 relevance (BM25-class) tuning; how metadata-tier matches
   interleave with full-text hits without misleading the author about depth.
4. **EPUB text extraction fidelity** — footnotes, tables, poetry layout; what the
   indexable-unit is (paragraph? section?) so citations anchor stably.
5. **Phase 2 shape** — embedding provider/model via `wegofwd-llm`, chunking,
   on-device vector store bounds, and the disclosure copy.
6. **Index refresh triggers** — on download/delete is obvious; behavior on
   new-edition update (ADR-025) of an authored book.

---

## Scope — what this ADR is *not*

- **Not** cloud retrieval **in the free (device-local) tier** — no server-side index,
  corpus, or query log; queries and interests never leave the device (Phase 2's BYOK
  provider calls are the sole, disclosed, opt-in exception). *The opt-in **paid** hosted
  tier (ADR-033) necessarily holds a server-side index over the user's own private corpus;
  its not-zero-knowledge posture and data rights are governed by ADR-033 D4.*
- **Not** automatic quoting or content generation *from* references — it finds and
  cites; what the author writes remains the author's.
- **Not** a rights adjudicator — rights are surfaced verbatim, never interpreted
  (D4).
- **Not** audio/video retrieval — audio parked (D5), video excluded by ADR-028 D2.
- **Not** recommendations or reading analytics — retrieval is author-initiated,
  per-query; nothing is profiled (ADR-028 D6 posture).
- **Not** the Everyone Library — corpus is strictly the local shelf.

---

## Staged plan (post-acceptance)

1. Text-extraction pass: authored `book.json` + downloaded EPUB/PDF → normalized
   indexable units with stable anchors (Open question 4).
2. On-device FTS index behind the library seam (build/query/delete; size caps;
   rebuild) (D2, D3, D6; Open question 1).
3. Reference panel in authoring: topic query → ranked results with source + rights;
   metadata-tier results with "download to make searchable" (D1, D4).
4. Insert-as-citation → Content Trust Manifest citation objects (D4, ADR-015).
5. Index lifecycle wiring: download/delete/update triggers + storage accounting in
   the Downloads view (D3; Open question 6).
6. *(own switch)* Phase 2 BYOK embeddings: opt-in flow, disclosure copy, vector
   store, hybrid ranking (D2; Open question 5).
7. *(parked)* audio transcription-and-index opt-in (D5).

---

## Follow-up tickets

- **SBQ-REF-001** — extraction + indexable-unit/anchor scheme (staged plan 1; Open
  question 4).
- **SBQ-REF-002** — on-device FTS index library: build/query/delete/caps (staged
  plan 2; Open questions 1, 3).
- **SBQ-REF-003** — authoring reference panel + tiered results + rights surfacing
  (staged plan 3).
- **SBQ-REF-004** — citation objects into the Content Trust Manifest (staged
  plan 4).
- **SBQ-REF-005** — index lifecycle triggers + storage accounting (staged plan 5).
- *(carried)* Phase 2 embeddings (Open question 5); audio indexing (D5).
