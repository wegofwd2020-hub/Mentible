# ADR-029 vs ADR-032 — scope and comparison (decision support for ADR-033)

> **Superseded by the 2026-07-15 design** (`2026-07-15-adr-033-per-user-private-hosted-library-design.md`).
> The decision narrowed from "reject hosting outright" to "reject ADR-032's broad shape,
> **accept a per-user *private* hosted tier** (ADR-033)." This document is retained as the
> record of the intermediate full-rejection reasoning; its body is unchanged.

**Date:** 2026-07-14
**Purpose:** Lay out exactly what ADR-032 proposed, and compare it dimension-by-dimension
against ADR-029, so the decision to reject the hosted tier (ADR-033) is legible to a future
reader. Companion to `2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md`.

---

## Part 1 — ADR-032, scoped

**One line.** Keep ADR-029's device-local tier as a free baseline, and bolt an **opt-in paid
hosted account** beside it — a server-hosted library plus server-side RAG running on the
**vendor's managed keys**.

### Original decisions (D1–D10, 2026-07-12)

| # | Decision |
|---|---|
| D1 | Hybrid — device-local free baseline **+ opt-in hosted account (paid)** |
| D2 | Server content scope: PD downloads + **the user's own uploads** + authored books |
| D3 | Hosted RAG compute: server lexical FTS now, **managed-key** semantic embeddings later |
| D4 | Storage is a `Plan` axis; tiers = plans |
| D5 | Sync: **server is source of truth**, thin client queries/streams |
| D6 | Privacy: **not zero-knowledge** — the server must read content to index it — but opt-in + data rights |
| D7 | Copyright: hosting third-party files **loses ADR-028's neutral-conduit shield**; needs a registered DMCA agent + takedown; **legal review gates launch** |
| D8 | ADR-029 and ADR-030 **become dual-mode** (device-local free + hosted paid) |
| D9 | The whole hosted tier is **gated on the managed-billing launch** |
| D10 | Abuse posture: the tier is **paid**, which "structurally blunts" Sybil/abuse |

### The 2026-07-14 amendment (D11–D15)

De-risked the legal side; broke the cost model.

| # | Decision |
|---|---|
| D11 | **PD works only** — personal uploads never leave the device (amends D2, D7). Shrinks the DMCA surface to near-zero. |
| D12 | Trust the **source**, not the file's `Rights:` claim ("a pirated EPUB can assert `Rights: Public domain`") → allowlist = **Gutenberg only** |
| D13 | The PD corpus is **shared, global, deduplicated** — embedded once for everyone (amends D4) |
| D14 | Ingestion **fetches from the vetted source**, never accepts client bytes (anti-corpus-poisoning) |
| D15 | Grounding over the shared PD corpus is **free-tier, not gated on billing** (amends D9, D10) — the ADR concedes this **"breaks D10's abuse argument"** |

### Left open after the amendment

- **OQ-A1** — do the user's own *manuscripts* go server-side? (If yes: server-side RAG over
  unpublished work, which D6 concedes cannot be zero-knowledge.)
- **OQ-A2** — the global dedup key scheme ("needs a concrete scheme before build").
- **OQ-A3** — a retrieval query names the book IDs, so the backend learns what a user is writing
  against — erodes ADR-028's "preferences, not profiles" for free users who previously gave nothing.
- **OQ-A4** — **what does the paid tier now even sell?** With uploads device-local (D11) and the
  PD corpus free (D15), its value is narrowed to hosting/syncing the user's own material.

### What it costs the rest of the architecture

- **Amends ADR-001** (no server-side key custody) — hosted RAG runs on managed keys.
- **Amends ADR-014** (device-local default) — the hosted tier holds readable content.
- **Reverses ADR-028's "core promise"** (its own words) of device-local downloads.
- **Reshapes ADR-029 and ADR-030** into dual-mode.
- **Code written: zero.**

---

## Part 2 — ADR-029 vs ADR-032, head to head

| Dimension | ADR-029 (device-local) | ADR-032 (hosted) |
|---|---|---|
| **Corpus lives** | On the device | On the server (shared PD) + device |
| **Corpus content** | *Your* books — authored + downloaded | A **global** PD corpus, shared across all users |
| **Keys** | BYOK; Phase-2 embeddings on **your** key | **Managed** keys — the vendor's |
| **Who pays for tokens** | Nobody (Phase 1) → you (Phase 2) | **The vendor** — including for free users (D15) |
| **Privacy** | Nothing leaves the device | **Not zero-knowledge**; server reads content; queries reveal interests (OQ-A3) |
| **Server holds user content** | No | **Yes** — readable |
| **Copyright exposure** | None (device-local, neutral conduit) | Real (hosting); shrunk to PD-only by D11 but still needs a DMCA agent + legal review |
| **Abuse / cost surface** | None | Free-tier token spend + Sybil — **D15 admits the guard is broken** |
| **Cross-device sync** | **No** — per-device index | **Yes** — server is source of truth |
| **Amends prior ADRs** | None | **ADR-001, ADR-014, ADR-028** |
| **The moat** (BYOK / no token bill / no server content) | **Preserved** | **Traded away** |
| **Ships when** | Now (device-local, no deps) | Gated on managed-billing — except D15's free grounding, which isn't |
| **Code today** | Zero | Zero |
| **Status** | Proposed → stays (buildable) | Proposed → **Rejected by ADR-033** |

---

## The verdict the table makes obvious

Read the **cross-device sync** row against everything below it.

**The only capability ADR-032 buys over ADR-029 is cross-device sync of the library and index.**
For that one convenience it takes on: server-side storage of user content, the vendor's token bill
in front of free users, copyright/DMCA exposure, a Sybil surface its own author calls broken, a
privacy downgrade from zero-knowledge, and amendments to three *Accepted* ADRs.

That is the trade laid bare — **one convenience feature bought with the product's entire
differentiator.** Rejecting ADR-032 does not give up retrieval; ADR-029 delivers that. It gives up
*cross-device sync as a paid tier*, and keeps everything that made the product defensible.
