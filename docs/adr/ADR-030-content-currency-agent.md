# ADR-030 — Content currency agent: watching the world so editions stay current

**Status:** Proposed — 2026-07-10 · **amended by ADR-033 (2026-07-15):** the author-side
BYOK check (D2) stays the free/BYOK path; the **scheduled/background** form (D4) lives on
the per-user private hosted tier (ADR-033).
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-008 (release lifecycle — the agent is the missing *upstream
trigger* for a new edition), ADR-025 (new-edition redistribution — the downstream
loop the agent's output terminates in), ADR-015 (content-trust manifest — the watch
manifest extends it; accepted revisions stay model-attributed), ADR-001 (BYOK — no
server-side key custody; MVP runs author-side), ADR-016/013 (managed billing &
metering, built-but-off — the gate for the scheduled form), ADR-028 (Open Shelves —
feed refresh doubles as a cited-source update-detection channel), ADR-029
(library-grounded references — citations become watchable objects), ADR-023
(engagement events — a currency-driven update is a distinct event).

---

## Context

Mentible's edition machinery is complete on the *downstream* side: ADR-008 versions
and records changes, ADR-025 notifies readers and applies updates safely. What
nothing does is give the author a **reason to cut edition 1.1**: once a book ships,
the world moves — an API gets a v2, a statistic is superseded, a law changes — and
the book silently goes stale. "Staleness hints" exists **(partial)** but has no
engine behind it.

The idea: an agent that **watches the outside world against what a book claims**
and tells the author when content needs updating. This is the feature that upgrades
"living book" from a *media* claim (audio/video inline) to a **lifecycle** claim —
books that stay current — and it is the closed loop competitors' chat tools cannot
offer, because their output has no edition to update.

Two hard constraints shape the design. **Key custody:** a continuously running
server-side agent would have to hold and spend the author's API key on Mentible
infrastructure — forbidden by ADR-001. **Cost boundedness:** "watch the world" is
unbounded unless the book declares what it is *about* in watchable terms. Both have
clean answers below; notably, every dependency this ADR touches is either **live or
built-but-off** — it is gated on switches, not construction.

---

## Decision (proposed)

### D1 — Every published book gets a **watch manifest**, derived at publish time

At publish/compile, Mentible derives a bounded, structured set of **watchable
claims/topics** from artifacts that already exist — the scoped query, the topic
tree, and (where ADR-029 is in play) the citation objects. The watch manifest is a
**versioned extension of the Content Trust Manifest** (ADR-015), travels with the
book's metadata, and caps agent cost by construction: the agent checks the
manifest, not the internet. Regenerated on each new edition.

### D2 — MVP is an **author-initiated currency check**, run **author-side on BYOK**

A "Check currency" action in the authoring client runs the agentic pass — web
lookups per manifest item via the `wegofwd-llm` seam, compared against the book's
content — **on the author's device with the author's key**, with an **up-front cost
estimate** (manifest size × checks) and live spend visibility. No Mentible-side key
custody, no background infrastructure — fits ADR-001 exactly and ships against
what is live today.

### D3 — The agent **proposes, never edits**: output is a **staleness report** into the ADR-008/025 loop

The check produces a structured **staleness report** — per finding: the claim, the
evidence found, a confidence class, and a suggested revision — which the author
reviews. Accepting findings drafts changes that flow through the normal **ADR-008
edition** flow and ship to readers via **ADR-025 redistribution**; the changelog
cites the findings. **No unsupervised mutation of published content, ever** — the
same human-in-the-loop philosophy ADR-025 fixed on the reader end, applied to the
author end, and the only stance that keeps the provenance story honest (accepted
revisions carry model attribution in the manifest per ADR-015).

### D4 — The **scheduled/background** form is **gated on managed billing**

Periodic watching without the author present requires Mentible-side execution and
spend — exactly what ADR-016/013's managed-key vault + metering (built, off) exist
for. The scheduled agent is therefore **specified now, enabled only with the
managed-billing launch**, as its own switch with per-book frequency and spend caps.
It is a natural flagship for that re-launch; nothing in the MVP presumes it.

### D5 — **Cited sources are watched through Open Shelves feeds**

Where a book cites an external work (ADR-029 citation objects carrying ADR-028
source refs), the **existing feed-refresh machinery doubles as an update-detection
channel**: a new edition of a cited source appearing in its feed raises a
zero-token staleness finding ("cited work has a newer edition"). The three
capabilities chain: Shelves supply sources, References cite them, Currency watches
the citations.

### D6 — Findings are **classed and thresholded** to protect signal

Findings carry a confidence/severity class (e.g. *superseded fact* vs *new
development worth mentioning* vs *cosmetic*), the report defaults to showing
high-confidence items with the rest collapsed, and per-book **noise controls**
(mute a manifest item, tune sensitivity) are first-class. A currency agent that
cries wolf damages the exact credibility it exists to build; precision is a
requirement, not a tuning afterthought — and the feature is proven on our own
default-library books before it is promoted as a capability.

---

## Open questions

1. **Watch-manifest format** — item schema (claim text, anchors into content,
   check hints), size bounds, and its versioning inside the trust manifest (D1).
2. **Lookup tooling** — how the author-side check performs web lookups across BYOK
   providers via `wegofwd-llm` (provider-native search tools vs a search seam);
   provider capability variance.
3. **Staleness scoring** — the confidence/severity rubric and default thresholds
   (D6); what "high confidence" must mean at MVP.
4. **Report UX** — review/accept/dismiss flow and how accepted findings prefill
   the edition draft + changelog (D3).
5. **Cost estimator fidelity** — how close the pre-run estimate must be; partial
   runs (check only chapters 1–3) as a cost control (D2).
6. **"Staleness hints (partial)" convergence** — fold the existing partial feature
   into the report surface, or keep hints as the lightweight always-on layer the
   full check deepens.
7. **Scheduled-form policy** (deferred with D4) — frequency floor/ceiling, spend
   caps per book, and notification channel when the author isn't in-app.

---

## Scope — what this ADR is *not*

- **Not** auto-editing — published content changes only through author-accepted
  edition flow (D3).
- **Not** server-side BYOK execution — MVP runs author-side; the server form waits
  for managed billing's own key custody (D2, D4, ADR-001).
- **Not** general web monitoring — the agent checks the watch manifest, nothing
  else (D1).
- **Not** a fact-checker of the *original* authoring pass — it detects *drift
  since publish*; initial accuracy remains the authoring flow's concern.
- **Not** reader-facing — readers see its effects only as ADR-025 edition updates
  with changelogs.
- **Not** new telemetry — a currency-driven update is an ADR-023 event like any
  other; findings and reports stay author-local.

---

## Staged plan (post-acceptance)

1. Watch-manifest derivation at publish (scoped query + topic tree → items),
   versioned into the trust manifest (D1; Open question 1).
2. Author-side check runner over `wegofwd-llm`: per-item lookup + compare, cost
   estimate + live spend, partial-run controls (D2; Open questions 2, 5).
3. Staleness report: classed findings, thresholds, mute/sensitivity controls
   (D3, D6; Open question 3).
4. Accept-flow into ADR-008 edition draft + changelog prefill; ships via ADR-025
   (D3; Open question 4).
5. Cited-source watch: feed-refresh hook raising newer-edition findings (D5;
   with ADR-028/029 in place).
6. Converge "staleness hints (partial)" onto the report surface (Open question 6).
7. *(gated on managed billing)* scheduled watch: server-side runner on ADR-016/013
   metering, per-book frequency + caps (D4; Open question 7).

---

## Follow-up tickets

- **SBQ-CUR-001** — watch-manifest schema + publish-time derivation (staged
  plan 1).
- **SBQ-CUR-002** — author-side check runner + cost estimator + partial runs
  (staged plan 2).
- **SBQ-CUR-003** — staleness report UI: classes, thresholds, noise controls
  (staged plan 3).
- **SBQ-CUR-004** — accept-flow → edition draft + changelog prefill (staged
  plan 4).
- **SBQ-CUR-005** — cited-source watch via feed refresh (staged plan 5).
- *(carried)* staleness-hints convergence (Open question 6); scheduled form at
  managed-billing launch (D4; Open question 7).
