# Mentible Cost Model — Unit Economics under BYOK

> **Status:** Reference / cost analysis. **Date:** 2026-08-25.
> **Question answered:** "If users bring their own LLM key (BYOK), are hosting + user
> storage my primary costs — or am I missing something?"
> **Short answer:** Directionally yes — BYOK removes the biggest *variable* cost (LLM
> tokens). But "hosting + storage" undercounts **egress/bandwidth** and the fact that
> your synced-book storage lives in **Postgres**, not object storage. Both are driven by
> the large-EPUB sync feature, not by "hosting" per se.
> **Companion:** [`2026-08-25-groq-default-testing-phase.md`](../proposals/2026-08-25-groq-default-testing-phase.md)
> · ADR-005 (money model) · ADR-014 (zero-knowledge sync).

---

## 0. TL;DR

- **BYOK's win is predictability:** it moves the LLM token bill (the fastest-scaling, least
  predictable cost) onto the user, leaving you with **mostly fixed + slowly-growing** infra.
- **The two costs that will actually surprise you** — both from the ZK EPUB **sync** feature,
  not from "hosting":
  1. **Egress / bandwidth** — syncing whole encrypted books (up to ~30 MB each) up **and** down,
     per device. Scales with *activity*, invisible until the bill.
  2. **Database storage** — synced books/EPUBs are stored as **base64 ciphertext in Supabase
     Postgres** (the *expensive* place to keep blobs), not object storage.
- **Compute is not zero under BYOK** — your Celery workers + the Node/puppeteer EPUB/PDF compiler
  still run on every generate/publish.
- **Residual managed-LLM** — if trust-artifact generation stays on Anthropic (recommended), even
  BYOK users cost you Anthropic tokens for trust artifacts.
- **None of this bites at 5 testers.** All of it is what to watch as you scale — and the two big
  ones have clean fixes (object storage + egress-friendly CDN).

---

## 1. Where the money actually goes

Grounded in the code on 2026-08-25:

| Cost center | Driver | Evidence | Scaling risk |
|---|---|---|---|
| **Egress / bandwidth** ⚠ | ZK EPUB sync (≈30 MB blobs, up + down, per device) + serving the web app | Inc-2.1 native-EPUB-crypto sync; `sync/schemas.py` blob payloads | **High** — scales with activity, not stored volume; the sleeper cost |
| **Supabase — DB storage** ⚠ | Synced books/EPUBs stored as **base64 ciphertext in Postgres** | `sync/schemas.py` `BookBlobIn.ciphertext: str` (base64); DB = "Supabase Postgres via asyncpg" (`config.py:154`) | **High** — free tier ≈ 500 MB DB; a few 30 MB books blow past it |
| **Supabase — Auth** | MAU (identity/JWKS) | IdP = Supabase (`config.py:61-67`) | Medium — free MAU cap, then paid |
| **VPS compute** | FastAPI + Celery workers + Redis + **puppeteer/Chromium** EPUB/PDF compile | shared infra (D11); compiler is CPU/RAM heavy per publish | Medium — publish spikes |
| **VPS disk** | Published artifact store (EPUB/PDF) | `artifact_store.py` → `artifact_store_dir/<book_id>/<fmt>.<ext>` (local filesystem) | Low — cheap, grows with published books |
| **Residual managed LLM** | Trust artifacts on Anthropic (if kept managed) | `trust/schemas.py` `provider_id="anthropic"` | Low at test scale; real line, not zero |
| **Fixed** | Domains (`mentible.app` + `mambakkam.net`), Google Play ($25 one-time), Apple ($99/yr if iOS) | — | Predictable |
| **Ops** | Backups, monitoring, your time | — | Not infra, but real |

---

## 2. The two surprises, explained

### 2.1 Egress is the sleeper (likely your real #1)
The ZK sync pushes/pulls **whole encrypted books** — up to ~30 MB each — **per device**. That's
**transfer**, not storage, and it scales with how *actively* people sync (web + phone = a book
moves multiple times), not with how much you store. A handful of testers with large books moves
gigabytes. Egress is the cost that's invisible until the invoice.

### 2.2 Your "storage" is mostly Postgres — the expensive kind
> Synced book/EPUB ciphertext lives **in Supabase Postgres**, not object storage.

Supabase free tier is ≈ **500 MB database**. A *few* 30 MB books exceed it → Supabase Pro
(~$25/mo) plus storage/egress overages. Postgres is the priciest place to keep large blobs.

**The clean fix (when it grows):** because sync is **zero-knowledge** — the server only ever holds
ciphertext it cannot read (ADR-014) — the blobs can safely move to **object storage**
(Cloudflare R2 = ~$0 egress, cheap at-rest). That single move addresses **both** §2.1 and §2.2:
cheaper at-rest **and** near-zero egress. Keep only the *metadata* row in Postgres. This is the
first architectural cost-optimization to reach for at scale; not needed at testing scale.

---

## 3. Why compute isn't zero under BYOK

BYOK offloads the **LLM call**, not your backend:
- **Celery workers** orchestrate the whole-book fan-out (one job per topic) — durable async
  generation runs on your box regardless of who owns the LLM key.
- **The Node/puppeteer compiler** builds every EPUB/PDF (headless Chromium — CPU + RAM heavy per
  publish).

So "BYOK ⇒ compute is free" is false. BYOK zeroes **token spend**, not **your compute**.

---

## 4. Residual managed-LLM (the "BYOK ≠ $0 LLM" nuance)

If you follow the recommendation to keep **trust-artifact generation on Anthropic-managed** (the
cited product spine — see the Groq proposal §4), then **even BYOK users** generate trust artifacts
on **your** Anthropic key. "Everyone BYOK ⇒ zero LLM cost" holds **only if trust is also BYOK**.
Small at test scale; a real line to remember when modelling margins.

---

## 5. What this means for pricing / subscription

- **BYOK plan** ≈ **fixed-cost** to serve: app + upkeep + storage/egress. A subscription here mainly
  covers infra + the app itself (ADR-004/005 D17: BYOK fee = app + upkeep only). Margin is
  predictable; the variable risk is **egress**, not tokens.
- **Managed plan** adds the metered token allowance on top (you carry the vendor cost) — that's the
  usage-variable line BYOK removes.
- **The cost that both plans share** and that grows with success is the **sync storage + egress**.
  Price/plan design should account for *sync volume* (books × size × devices), and the fair-use cap
  (D18, ~100 units) is as much a **storage/egress lever** as a token lever.

---

## 6. Scaling watch-list (in order of when it bites)

1. **Egress** — monitor first; move blobs to R2/CDN when it climbs.
2. **Supabase DB size** — the 500 MB → Pro cliff arrives quickly with large EPUBs; plan the
   object-storage migration before it's urgent.
3. **Supabase Auth MAU** — watch the free-tier MAU cap as testers → real users.
4. **VPS compute** on publish (puppeteer) — fine until many concurrent compiles.
5. **Residual managed LLM** (trust) — only if trust stays managed.

**At 5 testers:** none of this matters — you're comfortably inside every free tier. This note is
the map for when you're not.

---

*Prepared from a code map (`sync/schemas.py`, `library/artifact_store.py`, `config.py`,
`trust/schemas.py`) on 2026-08-25. File:line references current as of that read; verify Supabase /
egress tier limits live, as they move.*
