# SBQ-TRUST-004 — Feed the D7 staleness affordance ("made with an older model — regenerate?")

> Paste-ready ticket. Completes the **content-version / staleness** half of
> **ADR-016 D7**: the `<TrustBadge>` already renders an `isStale` hint, but nothing
> computes it. This ticket exposes the registry's *current* version to the client
> and diffs each unit's stored provenance against it.
> Follow-up to **SBQ-TRUST-001** (badge + per-topic render, merged in PR #106).

---

## JIRA fields

| Field | Value |
|-------|-------|
| **Project** | StudyBuddy Q (SBQ) |
| **Issue Type** | Story |
| **Summary** | Compute per-unit staleness and feed the TrustBadge `isStale` hint |
| **Component** | backend / generate · mobile / hooks · mobile / components |
| **Labels** | `enhancement`, `trust`, `adr-016`, `provenance` |
| **Priority** | Low–Medium (UX nicety; not blocking) |
| **Estimate** | 3 story points |
| **Dependencies** | **Hard:** SBQ-TRUST-001 merged (`<TrustBadge isStale>`, `Provenance` carries `integration_version`/`contract_version`). **None** on `wegofwd-llm` ≥ v0.2.0 — this uses the *already-shipped* `registry.provenance()` / `is_stale()`. |
| **Fix Version** | v1 — Android alpha (post-badge) |

---

## User Story

> **As a** self-learner whose books may span several generations and model versions
> **I want** a quiet "made with an older model — regenerate?" hint on stale content
> **so that** I can refresh anything produced by an integration we've since improved,
> without re-reading every chapter to guess.

This is the staleness use ADR-012's provenance vector was designed for and ADR-016
D7 made a UI requirement.

---

## Background — almost everything already exists

| Piece | Where | Status |
|---|---|---|
| Stored unit provenance (`provider, model, integration_version, contract_version`) | `GeneratedTopic.provenance` (mobile) — stamped by the worker from `registry.provenance()` | **shipped** |
| Drift definition + comparator | `pipeline/providers/config.py` → `_DRIFT_KEYS`, `is_stale(stamped, resolved)` | **shipped** (backend, unused by the client) |
| Current registry version | `wegofwd_llm.registry.provenance(provider)` → `integration_version` (per provider), `contract_version` (`LLM_CONTRACT_VERSION = 1`), `default_model` | **shipped** |
| `<TrustBadge isStale>` hint render | `mobile/src/components/TrustBadge.tsx` | **shipped, unfed** |

**The only gap:** the client holds each unit's *stamped* provenance but cannot see
the registry's *current* version (`integration_version`/`contract_version` are
seam-owned, server-side). So it can't run the diff. This ticket closes exactly that
gap — expose current provenance, diff client-side.

---

## Decision — expose current provenance; diff on the client

**Why client-side diff (not a backend `is_stale` round-trip per unit):**
- The library is **local-first** (ADR-003) — the client already holds every unit's
  provenance. One cheap, cacheable "what's current?" call lets it diff the whole
  library locally; a batch staleness POST would ship the library's provenance to
  the backend on every read.
- The comparison is trivial (equality on ≤4 keys) and **key-free** — it needs no
  BYOK key, so staleness works even before a key is loaded.
- The backend `is_stale` semantics are mirrored in one small, unit-tested helper.

(Alternative — `POST /registry/staleness` reusing `is_stale` verbatim — is noted in
§Open as the fallback if we ever want exact backend parity incl. config-version
drift.)

### Staleness scope (v1): engine/seam drift **and** model drift

Per ADR-016 D7 verbatim — `integration_version`/**model** older than current —
compare all three engine axes:

```
isStale = stored.model              !== current.model
       || stored.integration_version !== current.integration_version
       || stored.contract_version    !== current.contract_version
```

The subtlety is **what `current.model` means**, and it's what avoids the false
positive I worried about. A unit's `model` differing from the provider's *bare*
registry default is often a **deliberate** choice (ADR-016 D2: "a free provider to
draft, Anthropic for the final") — nagging that would be wrong. So we compare not
against the bare default but against the **book's pin-resolved current model**:

> `current.model` = the book's pinned model (`generationParams.model`) if set,
> **else** the provider's current registry default.

This is exactly the backend's own logic — `is_stale(stamped, resolved)` where
`resolved = resolve_llm_config(author, book)` resolves the pin-or-default model
(`pipeline/providers/config.py`). It gives the right answer in every case:

| Book config | Unit made with | Current default | `current.model` | Stale? |
|---|---|---|---|---|
| pinned `opus-4-8` | `opus-4-8` | `sonnet-4-6` | `opus-4-8` (pin) | **no** — honours the deliberate pin |
| no pin (`null`) | `sonnet-4-6` | `sonnet-5` | `sonnet-5` (default) | **yes** — the recommended model moved on |
| pin changed `opus`→`sonnet` | `opus-4-8` | — | `sonnet…` (new pin) | **yes** — config genuinely changed |

So model drift is **in v1**, with zero false positives from deliberate pinning —
the comparison is pin-aware by construction.

**Still out of scope: config-version drift** (`author/book_config_version`, also in
`_DRIFT_KEYS`) — a separate "you changed your settings" signal, not the "older
model" hint D7 describes.

---

## Backend — one read-only endpoint

`backend/src/generate/router.py` (or a small `registry` router). Returns the
current provenance for a provider; key-free public metadata, safe to cache.

```python
from wegofwd_llm.registry import PROVIDER_REGISTRY, provenance

@router.get("/registry/current")
async def registry_current(provider: str = "anthropic", model: str | None = None) -> dict:
    """Current resolved provenance for a book's LLM config (pin-or-default model +
    version axes). Pass the book's `generationParams.model` as `model` so the
    returned `model` reflects the pin; omit it for the provider default. No BYOK
    key, no generation — public registry metadata for client-side staleness
    diffing (ADR-016 D7). 404 on an unknown provider."""
    if provider not in PROVIDER_REGISTRY:
        raise HTTPException(status_code=404, detail=f"unknown provider {provider!r}")
    return provenance(provider, model)   # validate_selection resolves model→pin or
                                         # default; falls back to default if the pin
                                         # is no longer a valid model for the provider
```

> `provenance(provider, model)` runs `validate_selection`, so a passed pin is
> echoed back (or falls to the default if it's no longer valid), and an omitted
> model returns the provider default. `integration_version` is the provider's spec
> version; `contract_version` is the global seam version (`LLM_CONTRACT_VERSION`).

**Caching:** the value changes only on deploy → set `Cache-Control: public, max-age=3600`.

---

## Mobile wiring

### 1. `mobile/src/api/client.ts` — fetch current provenance (pin-aware)

```ts
export async function getCurrentProvenance(
  providerId: string,
  model: string | null,        // the book's generationParams.model (null = default)
): Promise<Provenance> {
  const q = new URLSearchParams({ provider: providerId });
  if (model) q.set("model", model);
  const res = await fetch(`${BASE_URL}/registry/current?${q}`);
  if (!res.ok) throw new Error(`registry/current ${res.status}`);
  return (await res.json()) as Provenance;   // current.model = pin or default
}
```

### 2. `mobile/src/lib/staleness.ts` (new) — the pure comparator

```ts
import type { Provenance } from "@/types/lesson";

// Mirrors the engine subset of pipeline/providers/config.py::_DRIFT_KEYS
// (model + integration_version + contract_version; NOT config-version keys).
// `current` must be the book's PIN-RESOLVED provenance (see getCurrentProvenance),
// so a deliberate model pin compares equal and is never flagged.
// Returns undefined when we can't decide (missing data either side) — the badge
// then shows NO hint rather than guessing stale/fresh.
export function isUnitStale(
  stored: Provenance | undefined,
  current: Provenance | undefined,
): boolean | undefined {
  if (!stored || !current) return undefined;
  if (stored.integration_version == null || current.integration_version == null)
    return undefined;
  return (
    stored.model !== current.model ||
    stored.integration_version !== current.integration_version ||
    stored.contract_version !== current.contract_version
  );
}
```

### 3. Cache the current provenance — `mobile/src/hooks/useCurrentProvenance.ts` (new)

A tiny hook (or module-level memoized fetch) keyed by **`provider + model`** (the
key must include the pin, since `current.model` depends on it), fetched once per app
session (or AsyncStorage, 1 h TTL). The topic screen and a future Library staleness
pip share the cache → no per-unit network.

### 4. Topic screen — feed the badge

`mobile/app/book/topic/[bookId]/[topicId].tsx`:

```tsx
const provider = book?.generationParams?.provider ?? "anthropic";
const pinned  = book?.generationParams?.model ?? null;       // the book's model pin
const current = useCurrentProvenance(provider, pinned);      // undefined until loaded / on failure
const stale   = isUnitStale(topic?.provenance, current);     // undefined ⇒ no hint
// …
<TrustBadge manifest={trustManifest} revisionCount={topic?.revisionCount} isStale={stale} />
```

`isStale` is `boolean | undefined`; `<TrustBadge>` already treats anything falsy as
"no hint", so an unresolved/failed fetch simply shows nothing — never a false flag.

---

## Honest behaviour (load-bearing)

- **Unknown ⇒ silent.** Offline, backend down, missing version on either side →
  `isStale` undefined → **no hint**. We never claim "fresh" we can't prove, nor
  nag "stale" on a guess.
- **No false positives from deliberate model choice** — model drift is compared
  against the book's *pin-resolved* model, so a unit made with the model you pinned
  is never flagged; only a genuinely moved default (or a changed pin) is.
- **No new generation data, no BYOK key** — pure metadata diff (ADR-016 D7).

---

## Acceptance Criteria (Gherkin)

```
AC1  Given GET /registry/current?provider=anthropic (optionally &model=<pin>)
     Then it returns {provider, model, model_verified, integration_version,
     contract_version} with no key material and a cacheable header, where `model`
     is the passed pin (resolved) or the provider default when omitted.

AC2  Given a topic stamped with integration_version N and the registry now at N+1
     Then isUnitStale returns true
     And the badge shows "Made with an older model — regenerate?".

AC3  Given a topic whose model + integration_version + contract_version equal the
     book's pin-resolved current provenance
     Then isUnitStale returns false and no hint shows.

AC4  Given the registry call fails or a version is missing on either side
     Then isUnitStale returns undefined and the badge shows no hint (never a guess).

AC5  Given a book with NO model pin, a topic made with the old default, and the
     registry default has since moved
     Then isUnitStale returns true (the recommended model moved on).

AC6  Given a book PINNED to model X and a topic made with X, while the provider
     default is some other model
     Then isUnitStale returns false (a deliberate pin is never flagged).

AC7  Given an unknown provider id
     Then /registry/current returns 404 (not a silent default).
```

---

## Tests

- **Backend:** `/registry/current` happy path (shape + no key), 404 on unknown
  provider, cache header present. (mock registry; no live calls.)
- **Mobile unit:** `isUnitStale` — older/equal integration_version, contract drift,
  model drift vs moved default (stale) vs honoured pin (not stale), missing-version
  ⇒ undefined, both-undefined ⇒ undefined.
- **Mobile render:** topic screen passes a true `isStale` through and the badge
  renders the hint; passes undefined and it doesn't. (extend the existing
  `TrustBadge.render.test.tsx` staleness case + a topic-screen test.)

---

## Rollout

1. Backend `/registry/current` + test.
2. Mobile `getCurrentProvenance` + `isUnitStale` + `useCurrentProvenance` cache + tests.
3. Wire the topic screen; later, an optional Library staleness pip reusing the cache.

---

## Open questions

1. **Config-version drift** (`author/book_config_version`) — surface "your settings
   changed since this was generated" at all, or is that noise? (Backend `is_stale`
   already tracks it; it's the one `_DRIFT_KEYS` axis this ticket omits.) Lean: out
   of scope — it isn't the "older model" signal D7 describes.
2. **Batch parity option.** If we later want exact backend `is_stale` parity
   (incl. config versions, single source of truth), swap the client diff for a
   `POST /registry/staleness` that takes `[{provenance, bookConfig}]` and returns
   flags. Trade-off: a round-trip + library provenance on the wire vs. one cached
   GET + a small client helper. Lean: keep the client diff unless parity bites.
3. **Where the hint acts.** Badge hint is informational; should tapping it deep-link
   to the topic's Regenerate panel? (Nice-to-have; the panel is on the same screen.)

---

## Out of Scope

- Auto-regeneration (always user-initiated — ADR-016 D3/D4 discipline).
- Config-version drift signal (open Q1).
- A Library-wide "N stale chapters" rollup (follow-up; reuses the same cache + helper).
