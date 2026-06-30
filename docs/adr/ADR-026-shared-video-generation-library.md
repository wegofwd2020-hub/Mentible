# ADR-026 — Video generation as a shared library (`wegofwd-video`)

**Status:** Accepted — 2026-06-30 · _amended 2026-06-30 (D7 v1.0 gate MET — both
real consumers wired)_
**Decision-maker:** Sivakumar Mambakkam

> **Amendment — 2026-06-30 (v1.0 gate met).** D7 deferred freezing the interface
> until **both** real integrations were wired and green; that condition is now
> satisfied:
> - **Consumer #1 — pramana (AI `veo` path):** drafts a compliance video at DRAFT
>   time, materialised onto the immutable `CourseVersion` at publish
>   (`pramana#4`). Exercises the BYOK Veo provider + S3 storage.
> - **Consumer #2 — kathai-chithiram (`deterministic-renderer` path):** wraps its
>   existing `SceneScriptRenderer` as the caller-supplied render_fn, fully
>   in-process, child content never leaving the boundary (`kathai-chithiram#12`).
>   Exercises the non-AI provider + caller-owned filesystem storage.
>
> Two consumers on **two different provider paths** confirm the seam's shape holds
> (registry, capability check, provenance, the pluggable render_fn of D4). The
> second consumer also surfaced one real constraint — kathai is Python 3.10 — so
> the package floor was lowered to `>=3.10` in **`wegofwd-video` v0.1.1** (the
> exact kind of late discovery D7 named as the cost of building ahead of the rule).
>
> **Decision:** the D7 interface-freeze gate is **MET**. Cut **`wegofwd-video`
> v1.0** once both consumer PRs merge, graduating the package from v0.x (unstable)
> to a frozen, additive-by-default contract. The remaining open item is unchanged:
> complete the **live Veo network call** and flip the `veo` `model_verified` to a
> live-tested basis (a provider-integration change, not a contract change — it does
> not block v1.0).

**Relates:** **ADR-012** (the template this follows — library-not-service §D8,
caller-owns-secrets §D3, product-neutral/schema-agnostic §D2, semver/git-pin §D4;
`wegofwd-video` becomes the next member of the `wegofwd-*` family). **ADR-019**
(the family policy — this ADR records a **conscious exception** to its
"extract on the second real consumer" sequencing; see D7). **ADR-001** (key
discipline — BYOK, never source or log a key). **ADR-013** (Pramana in-process
generation — video generation is in-process too, not a service call). **ADR-005**
(multi-provider seam — same registry/role/provenance shape applied to video).
**kathai-chithiram ADR-001** (child-perspective safeguarding — its
no-training / zero-retention / pseudonymization model is what makes a shared
*service* unacceptable and a *library* the only fit).

---

## Context

Two products in the family share one content shape — **a story, an associated
video, then post-activities**:

| Product | Story | Video today | Post-activity |
|---|---|---|---|
| **kathai-chithiram** | parent text → pseudonymized scene script | **renders its own** (matplotlib/blender), no AI video | none yet (M1 wants engagement primitives) |
| **pramana** | SOX clause → lesson modules | **none** (an empty `CourseVersion.video_asset_id` S3 slot) | scored quiz → certificate |

The shared contract for this shape is already designed and validated against
**both** apps in `project-critique/story-video-template/` — a `StoryUnit` JSON
Schema, a Veo-3.1 video-brief prompt template, a provider-registry sketch
(`wegofwd_video.py`), and **two worked examples** (`example.kathai.json`,
`example.pramana.json`) that prove one contract fits both domains.

Video generation differs from the text seam (`wegofwd-llm`) in ways that shape
the package boundary:

- **Long-running & async** — a generation takes minutes, not seconds; the caller
  drives a submit→poll→result job on its own infra (Pramana=Celery, kathai=subprocess).
- **Large binary artifacts** — outputs are MB-scale files needing object storage
  (S3 / filesystem / GCS), which is the *caller's* concern.
- **Expensive** — per-call cost makes generate-and-select + upscale a deliberate
  workflow, not a hot path.

These differences do **not** change the library-vs-service answer; they only
sharpen where the boundary sits (D2/D4).

---

## Decision

### D1 — Video generation is a shared **library**, not a service

`wegofwd-video` is a Python package each consumer `pip install`s and runs **in its
own process**, exactly like `wegofwd-llm` (ADR-012 §D8). There is no video service
to deploy, scale, or keep up; each app makes its own outbound call to the vendor
with its own key.

| | Shared **library** (this ADR) | Shared **service** (rejected) |
|---|---|---|
| Deploy | nothing new — code in each app | a new 24/7 server to run/scale/secure |
| Keys | each app holds its own (D2) | a central store of everyone's keys — breaks ADR-001 |
| **Privacy** | child content never leaves kathai's process | child content traverses a shared multi-tenant component — **breaks kathai ADR-001** (no-training / zero-retention / residual-identifier hard stop) |
| Failure | no new failure point | down → neither app can generate |
| Latency | none added | an extra hop on an already-slow call |

The privacy row is decisive for kathai: a central service would route
pseudonymized-but-sensitive child content through code kathai does not control,
defeating its dispatch-time guarantees. The library keeps generation inside the
process that owns the data and the key.

### D2 — The caller owns all secrets, state, and storage; the package is pure

- **BYOK** — the caller passes the key string; the package never reads
  `os.environ`, a vault, or a secret store (ADR-012 §D3). It never logs, `repr`s,
  or returns a key in any error or `raw` field.
- **No storage** — the package returns a `VideoResult` (bytes / a vendor URI +
  metadata); **persisting** it (S3 key on `CourseVersion.video_asset_id`, or
  `media/<file>` on disk) is the caller's job.
- **No orchestration** — the package exposes a synchronous `generate()` plus a
  submit→poll job protocol; the caller wires that to its own queue.

### D3 — Product-neutral and schema-agnostic

The package owns the **provider registry**, **brief → vendor-request shaping**,
**provenance**, and **capability checks**. It contains **no** app's `StoryUnit`
governance, prompts, post-activity rules, or data model (ADR-012 §D2). The
`StoryUnit` schema and the Veo brief *template* stay in `project-critique` as the
shared content contract; the package only knows how to turn a `VideoBrief` into a
provider call.

### D4 — Pluggable providers, including a non-AI one

The registry mirrors `wegofwd-llm`: logical roles map to `(provider, model)` so
no model id is hardcoded in app code.

- `veo` — default **verified** AI generator (Veo 3.1: 1080p/4k, native audio,
  Ingredients-to-Video). Reach via Vertex AI / Flow, **not** the consumer Gemini
  app (that is the fast/720p tier).
- `deterministic-renderer` — kathai's safety path. The package defines the
  **interface** and wraps a **caller-supplied render callable**; the actual
  blender/matplotlib code stays in kathai. This lets kathai adopt the same brief
  + registry + provenance without sending child content to any vendor.
- `runway`, `kling` — **UNVERIFIED** placeholders, carried honestly per the
  LLM-registry convention.

### D5 — Distribution: own repo, semver tags, pinned git dependency

Same as ADR-012 §D4 — own git repo, semver tags, `pip install wegofwd-video @
git+…@vX.Y.Z`, editable path-install for local multi-repo dev. Three independent
version axes: package **semver**; **`VIDEO_CONTRACT_VERSION`** (the
request/brief/result shape); per-provider **`integration_version`** (how we call a
vendor). Additive → minor; breaking the contract → major + `VIDEO_CONTRACT_VERSION`
bump.

### D6 — Provenance is the shared cross-product vocabulary

`provenance(provider, model, seed) → {stage:"video", engine:"wegofwd-video",
provider, model, model_verified, integration_version, contract_version, seed}` is
the stamp written into `StoryUnit.provenance[stage=video]`, so stale/outdated
renders are detectable and regenerable — the same role `wegofwd_llm.provenance()`
plays for text. `model_verified` rides through honestly (Veo 3.1 is
**docs-verified, not yet live-tested** — flagged truthfully).

### D7 — Conscious exception to ADR-019's "extract on the second consumer" rule

ADR-019 (D5 / Sequencing) is binding policy: **copy-first, extract a `wegofwd-*`
package only when a second real consumer is actually wired to the seam.** Video
generation today has **zero** running consumers of the AI seam (Pramana has no
video gen; kathai only has its local renderer). By ADR-019's default, the correct
move would be to build the seam in-process in one app first and extract later.

**This ADR deliberately deviates** and creates the standalone package now. The
justification specific to this candidate:

1. **The interface has already met both consumers — on paper, but concretely.**
   Unlike ADR-019's identity case (one *Proposed* design, zero implementations),
   the `wegofwd-video` seam is fully specified and **validated against two worked
   examples** covering both domains (`project-critique/story-video-template/`).
   The premature-abstraction risk ADR-019 guards against — *freezing guesses* — is
   materially lower because the guesses have been checked against both callers.
2. **Both consumers are known and committed, not hypothetical.** ADR-019 deferred
   identity partly because kathai's needs were "largely unknown." Here both apps
   have a stated, designed need for the *same* shape.
3. **Adoption is intended to proceed in parallel in both apps.** Building in one
   app first then extracting would create an immediate two-way drift to reconcile;
   a single source from day one avoids it.

**The risk ADR-019 names is accepted, not waved away:** we are freezing a
cross-repo interface before two *running* callers exist. Mitigations:

- Stay at **v0.x (unstable)**; additive-by-default; `VIDEO_CONTRACT_VERSION`
  starts at 1 and bumps on any breaking shape change.
- Treat the **first two real integrations (Pramana, then kathai) as the
  interface-freezing gate** — **v1.0 is not cut until both are wired and green.**
- If either real integration forces a contract change, that is expected at v0.x
  and is the cost we accepted here.

This exception is scoped to `wegofwd-video`; it does **not** relax ADR-019 for any
other candidate (`wegofwd-billing` etc. keep extract-on-second-consumer).

---

## Alternatives considered

| Approach | Verdict |
|---|---|
| **Build the seam in-repo (Pramana) first, extract on the 2nd consumer** (ADR-019-faithful) | **Rejected for now** by the D7 exception. It is the lower-risk default and remains the fallback if the standalone package proves premature; chosen against because the interface is already validated against both consumers and parallel adoption is intended. |
| **A central video-generation service both apps call** | **Rejected.** Same grounds ADR-012 §D8 rejected a central LLM service — new 24/7 infra, a single failure point, a key honeypot — **plus** it breaks kathai's child-content privacy model (D1). |
| **Fold video into `wegofwd-llm`** (rename to `wegofwd-media`) | **Rejected.** ADR-019 rejects a kitchen-sink package; video pulls a different (heavier) dependency + storage footprint and a slower release cadence. kathai must be able to take AI video without forcing it into its LLM seam. Separate sibling, like `wegofwd-secure`. |

---

## Open questions

- **Repo location / release ownership** — same governance question ADR-012/019 left
  open; one owner per package keeps the contract coherent.
- **Live-test Veo** — flip `model_verified` to a live-tested basis after the first
  real generation from our stack (currently docs-verified per the LLM convention).
- **`deterministic-renderer` placement** — confirm the package keeps only the
  *interface* + callable wrapper, with blender/matplotlib staying in kathai.
- **v1.0 gate** — confirm "both real integrations green" as the freeze trigger (D7).
- **Shared scaffolding** — if `registry`/`provenance`/`errors` start duplicating
  `wegofwd-llm`, revisit a tiny `wegofwd-core` (deferred; ADR-019 warns against it
  pre-need).

---

## Consequences

**Positive:** one source of truth for the video seam from day one — no two-way
drift as Pramana and kathai adopt in parallel; the provider/registry/provenance
vocabulary is shared by type, not by copy; kathai keeps its deterministic safety
render under the same abstraction; every key stays inside the process that owns it.

**Negative:** a new repo + release process now, and — explicitly counter to
ADR-019's default — a cross-repo interface frozen before two *running* callers
exist. The v0.x / both-integrations-gate-v1.0 discipline (D7) is the price of that
choice; if it slips, the interface can churn in up to two repos. This exception
must not be cited to justify packaging the next candidate early.

---

## References

- ADR-012 — Shared LLM seam package; the `wegofwd-*` template this follows.
- ADR-019 — Common platform libraries; the extract-on-second-consumer policy this
  ADR consciously excepts (D7), scoped to `wegofwd-video` only.
- ADR-001 — BYOK key discipline; upheld by D2.
- ADR-013 — Pramana in-process generation; video generation is in-process too.
- ADR-005 — Multi-provider LLM support; the registry/role/provenance shape reused.
- kathai-chithiram ADR-001 — child-perspective safeguarding; the privacy model
  that makes a shared service unacceptable (D1).
- `project-critique/story-video-template/` — the `StoryUnit` contract, Veo brief
  template, registry sketch, and the two worked examples this package promotes.
