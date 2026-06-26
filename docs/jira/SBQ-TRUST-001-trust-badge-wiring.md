# SBQ-TRUST-001 — Trust Badge: packager wiring + per-artefact surface

> Paste-ready ticket. Implements **Surface 1** of ADR-015 (Content Trust Manifest)
> and the per-unit **provenance indicator** mandated by **ADR-016 D6/D7** (the
> TrustBadge is that single surface — no second badge).
> Code drafted: `mobile/src/types/trust.ts`, `mobile/src/components/TrustBadge.tsx`,
> and `wegofwd-llm/wegofwd_llm/trust.py` (`engine_trust`).

> **ADR-016 D6/D7 obligations folded in (2026-06-14).** The badge is the required
> *per-unit* provenance indicator. D7 requires the **LLM identity** (provider +
> model, human-readable) and the **content version** (`generatedAt` + monotonic
> regeneration count) to be **always visible** (collapsed), with the concrete
> model + versions and a **staleness affordance** on expand — and the copy to be
> **descriptive, never implying provider endorsement** ("allow-listed model", not
> "verified by <provider>"; headline "Quality-checked", not "Verified"). The
> mobile half below is **implemented**; the backend packager wiring landed once
> `wegofwd-llm` **v0.2.0** shipped (2026-06-26) — see Rollout.

---

## JIRA fields

| Field | Value |
|-------|-------|
| **Project** | StudyBuddy Q (SBQ) |
| **Issue Type** | Story |
| **Summary** | Stamp a Content Trust Manifest on each generation and show it as a TrustBadge |
| **Component** | backend / generate · mobile / components |
| **Labels** | `enhancement`, `trust`, `adr-015`, `adr-016`, `mvp` |
| **Priority** | Medium |
| **Estimate** | 5 story points |
| **Dependencies** | **Hard:** `wegofwd-llm` ≥ **v0.2.0** (adds `engine_trust`). Bump the pin in `backend/requirements.txt` from `@v0.1.0`. |
| **Fix Version** | v1 — Android alpha |

---

## User Story

> **As a** self-learner using StudyBuddy Q
> **I want** to see how each lesson was produced and what checks it passed
> **so that** I can trust the content before I rely on it.

---

## Background

The gates already run (verified-model provenance, validate→repair conformance,
BYOK posture). They were stamped as a bare `provenance` dict on the job status row
and never surfaced. This ticket replaces that with the **ContentTrustManifest**
(ADR-015), assembled by the worker (packager) and rendered by `<TrustBadge>`.

**Block ownership at each stage:**

| Block | Filled by | When |
|---|---|---|
| `provenance`, `validation` | `wegofwd_llm.engine_trust` (the seam) | generation worker (`tasks.py`) |
| `policy` | backend constants (PARAMETERS §5 / ADR-001) | generation worker |
| `compliance`, `integrity` | export/compiler (format-compliance check + `content_hash`) | **export time — separate ticket SBQ-TRUST-002** |
| `review` | n/a for Mentible BYOK self-learner (no human gate); set by **Pramana** | ADR-011 path only |

This ticket wires the **generation-worker** blocks; `compliance`/`integrity` land
at export (where the 13-parameter check and the content hash already live).

---

## Backend wiring (the packager)

### 1. `backend/src/generate/tasks.py`

Replace the bare `provenance` stamp with a manifest. The validation block comes
from the `ConformanceResult` the worker already has (`result.repaired` / `.attempts`).

```diff
-from wegofwd_llm.registry import build_provider, provenance
+from wegofwd_llm.registry import build_provider
+from wegofwd_llm.trust import PolicyBlock, engine_trust
+import dataclasses
+from datetime import datetime, timezone
```

```diff
     lesson: LessonOutput | None = None
-    prov: dict | None = None  # which provider/model/versions produced this unit
+    trust: dict | None = None  # ContentTrustManifest (ADR-015) for this unit
     last_error = "generation failed"
```

```diff
         lesson = result.parsed
-        # Stamp which provider/model + integration/contract versions produced this
-        # unit (the resolved model, which may differ from what was requested).
-        prov = provenance(provider_id, provider.model)
+        # Stamp the Content Trust Manifest (ADR-015). The seam fills provenance +
+        # validation from the resolved model and the conformance outcome; we attach
+        # the standing BYOK data policy. compliance/integrity attach at export.
+        manifest = engine_trust(
+            provider_id,
+            provider.model,
+            schema_validated=True,            # generate_validated returned → it validated
+            repair_attempts=max(result.attempts - 1, 0),
+            schema_id="lesson@1",
+            generated_at=datetime.now(timezone.utc).isoformat(),
+        )
+        manifest = dataclasses.replace(
+            manifest,
+            policy=PolicyBlock(byok=True, prompts_stored=False, key_stored=False),
+        )
+        trust = manifest.to_public_dict()
         if result.repaired:
             log.info("generation_repaired", job_id=str(job_id), attempts=result.attempts)
```

```diff
     await _write_status(
         redis_client,
         job_id,
         "done",
         result=lesson.model_dump(),
-        provenance=prov,
+        trust=trust,
     )
```

And in `_write_status`, swap the parameter name (keep it `dict`, no key material
can be present — `to_public_dict()` guarantees it):

```diff
-    provenance: dict[str, Any] | None = None,
+    trust: dict[str, Any] | None = None,
 ) -> None:
     payload: dict[str, Any] = {"status": status}
     if error is not None:
         payload["error"] = error
     if result is not None:
         payload["result"] = result
-    if provenance is not None:
-        payload["provenance"] = provenance
+    if trust is not None:
+        payload["trust"] = trust
```

> **Note — `generated_at`:** stamped here at the worker (ADR-015 §8 open question:
> worker vs export). For a single-unit lesson the worker is canonical; when a book
> is compiled from many units, prefer the export timestamp.

### 2. `backend/src/generate/schemas.py` — `JobStatusResponse`

```diff
     result: dict | None = None
-    # Which provider/model + integration/contract versions produced the result
-    # … See registry.provenance.
-    provenance: dict | None = None
+    # Content Trust Manifest (ADR-015): provenance + validation + policy at
+    # generation; compliance + integrity attach at export. Shape validated by
+    # wegofwd-llm/schema/content-trust-manifest.v1.json. Carries no key material.
+    trust: dict | None = None
```

### 3. `backend/src/generate/router.py` — pass-through

```diff
     return JobStatusResponse(
         job_id=job_id,
         status=payload.get("status", "queued"),
         error=payload.get("error"),
         result=payload.get("result"),
-        provenance=payload.get("provenance"),
+        trust=payload.get("trust"),
     )
```

---

## Mobile wiring  *(implemented)*

### 4. `mobile/src/types/lesson.ts` — extend `JobResponse`

```diff
+import type { TrustManifest } from "@/types/trust";
 export interface JobResponse {
   // …existing fields…
   provenance?: Provenance;
+  trust?: TrustManifest;   // ADR-015; provenance kept for back-compat with pre-trust jobs
 }
```

(The existing `Provenance` interface stays — `TrustManifest.provenance` extends
it. Added **alongside** `provenance`, not replacing it, so pre-trust jobs still
render.)

### 5. Per-unit render — the topic screen (ADR-016 D6: per unit, not per book)

The per-unit surface is the topic read screen
`mobile/app/book/topic/[bookId]/[topicId].tsx` (not a single `LessonRenderer`
host — that was the pre-ADR-009 single-lesson path). The topic body renders inside
a WebView, so the badge sits in the **native** screen, above the body:

```tsx
import { TrustBadge } from "@/components/TrustBadge";
import { trustManifestFromTopic } from "@/lib/topicTrust";
// …
const trustManifest = topic ? trustManifestFromTopic(topic) : null;
// …
{trustManifest && (
  <View style={styles.trust}>
    <TrustBadge manifest={trustManifest} revisionCount={topic?.revisionCount} />
  </View>
)}
```

A whole-book reader shows the **book-level** manifest (compliance + integrity) at
export — that's **SBQ-TRUST-002**, not this ticket.

### 6. Manifest source — `mobile/src/lib/topicTrust.ts` (new)

`trustManifestFromTopic(topic)` prefers a backend-persisted `topic.trust` (once
the worker wiring lands) and otherwise builds a manifest from the **already-stored**
`provenance` + `generatedAt` (ADR-016 D7 — "no new generation data required").
Returns `null` (badge omitted) when there's no provenance — imported/pre-3c units
render no badge rather than an unknown LLM. `validation.schema_validated` is set
`true` by sound inference (stored content necessarily passed the pipeline schema
gate); `compliance`/`integrity` are left unset (book-level, at export).

### 7. Content version — `GeneratedTopic.revisionCount` (ADR-016 D7)

`setTopicContent` (`mobile/src/storage/bookStore.ts`) bumps a monotonic
`revisionCount` on every overwrite of a topic's content; absent/0 = original. The
badge shows it as `<date> · rev N`. Any regeneration re-stamps `provenance` on the
same `gen`, so the (content version ↔ LLM) pair stays consistent (D7).

### 8. What the badge now shows (D7), and what it must not say

- **Always visible (collapsed):** headline (`Quality-checked` / `…(with notes)`),
  LLM identity (`Anthropic (Claude) · Claude Sonnet 4.6`), content version.
- **On expand:** structure/format/sourcing/review/integrity/policy rows; the
  footnote `Engine v<integration_version> · contract v<contract_version>`.
- **Staleness affordance:** the `isStale` prop renders a quiet "Made with an older
  model — regenerate?" hint. **Not yet fed** — the host needs the registry's
  current-default model/`integration_version` to compare against, which isn't
  exposed client-side yet (see Out of Scope).
- **Copy discipline:** never "Verified"/"verified by <provider>" — descriptive
  only ("allow-listed model", per ADR-012's `model_verified`).

---

## Acceptance Criteria (Gherkin)

```
AC1  Given a completed generation
     Then the job status row carries a `trust` object validating against
     content-trust-manifest.v1.json (provenance + validation + policy present).

AC2  Given a generated topic
     Then its TrustBadge shows "Quality-checked" collapsed
     And tapping it reveals: Generated by <model> (allow-listed model), Structure
     check, and the BYOK data policy line.

AC3  Given a generation that took a repair turn (result.attempts > 1)
     Then validation.repair_attempts > 0
     And the badge reads "…(auto-corrected)" but still a pass tone.

AC4  Given an unverified model (e.g. deepseek)
     Then provenance.model_verified is false
     And the badge shows it honestly ("· unverified"), as a note — never a green
     "Verified" headline.

AC5  Given the manifest has no compliance/integrity block (generation-only)
     Then the badge omits those rows (renders "not assessed" by absence) —
     never shows a pass it didn't earn.

AC6  No secret material: the `trust` payload never contains the api_key, the
     prompt, or a raw vendor payload (guaranteed by to_public_dict()).

# ── ADR-016 D6/D7 ──
AC7  (D6) The badge appears on the per-topic read screen; a book whose topics
     were generated by different providers shows each topic's own provenance.

AC8  (D7) Collapsed, the badge always shows the LLM identity (provider + model,
     human-readable, e.g. "Anthropic (Claude) · Claude Sonnet 4.6") and the
     content version ("<date> · rev N" after N regenerations) — without expanding.

AC9  (D7) A topic with no stored provenance (imported / pre-3c) shows no badge,
     not a badge with an unknown LLM.

AC10 (D7 copy discipline) No surface ("Generated by", headline, a11y label) reads
     as the named provider verifying or endorsing the content.
```

---

## Tests

- **Backend:** extend `test_generate_e2e.py` — assert `trust.provenance.model_verified`,
  `trust.validation.schema_validated`, `trust.policy.key_stored is False`, and a
  no-key-leak assertion on the serialised status row (mirror `test_no_key_in_logs`).
- **Mobile (done):**
  - `deriveTrustRows()` (pure) — allow-listed vs unverified model, repaired vs
    clean, compliance present/absent, pass_with_notes vs fail tone, review SoD,
    policy line assembly. (`__tests__/components/TrustBadge.test.ts`)
  - D7 helpers `humanizeModel` / `identityLine` / `contentVersionLine`. (same file)
  - `<TrustBadge>` render — collapsed always-visible identity + content version,
    detail rows behind expand, staleness gating, no-"Verified" copy.
    (`__tests__/components/TrustBadge.render.test.tsx`)
  - `trustManifestFromTopic` adapter — null without provenance, build from
    provenance, prefer persisted manifest. (`__tests__/lib/topicTrust.test.ts`)

---

## Rollout

1. Ship `wegofwd-llm` **v0.2.0** (ADR-015 code: `trust.py` + schema + tests). ✅ *(tagged 2026-06-26)*
2. Bump `backend/requirements.txt`: `wegofwd-llm[anthropic] @ …@v0.2.0`. ✅
3. Apply backend diffs (1–3) + mobile wiring (4–5). ✅ *(worker stamps the manifest;
   `JobStatusResponse`/router carry `trust`; the generate hooks read provenance from
   the manifest; e2e tests assert provenance/validation/policy + no-key-leak)*
4. **SBQ-TRUST-002** (follow-up): attach `compliance` (format-compliance check) +
   `integrity` (`content_hash`) at export/compile time.
5. **Surface 2** (separate): generalise SBQ-UI-002 into the shared Trust Page.

---

## Out of Scope

- Export-time `compliance`/`integrity` blocks (SBQ-TRUST-002).
- The program-level Trust Page (Surface 2).
- Pramana's `review`/SoD block (ADR-011 path).
- Persisting the manifest onto saved library units (follow-up once the badge ships).
- **Feeding the D7 staleness affordance.** The badge renders the `isStale` hint,
  but computing it needs the registry's current-default model/`integration_version`
  exposed to the client (or a backend-computed `stale` flag). Follow-up — tracked
  against ADR-012/016 D7. Until then `isStale` is left unset.
