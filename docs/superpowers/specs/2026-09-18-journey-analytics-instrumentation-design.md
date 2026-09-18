# Journey analytics — sub-project 1: event schema + journey-state evaluator

**Status:** Draft, pending user review
**Source:** `Mentible_User_Journey_Analytics_Build_Specification.docx` (Sridhar, v1.2, 2026-09-15)
**Scope of this spec:** the first of four sub-projects the source doc bundles together. This
one covers the typed event schema, the event ingestion path, and the journey-state evaluator.
It explicitly excludes stall detection, the human-approved email pipeline, and dashboards —
those are separate specs, sequenced after this one per the source doc's own "Build sequence"
note ("Instrumentation and journey-state calculation may begin before all open decisions are
resolved. Automated outbound interventions and payment-specific behavior require explicit
product approval.").

## Why sub-project 1 first

The source doc bundles four largely-independent subsystems: (1) event schema + journey-state,
(2) stall detection + intervention state machine, (3) human-approved email pipeline, (4)
dashboards/metrics. Sub-project 1 is the dependency root — (2), (3), and (4) all read from
`journey_state`/`analytics_event`. It's also the only one unblocked by the doc's own "Open
Product Decisions" list (analytics platform choice, paywall placement, email provider, consent
model, support SLA — all unresolved, all irrelevant to schema + evaluator).

## Conflict with the source doc, and how this spec resolves it

The source doc describes a generic SaaS funnel (landing → signup → checkout → paywall) that
doesn't map 1:1 onto Mentible's actual shape:
- There's no literal checkout page. Billing is RevenueCat-entitlement-based
  (`backend/src/billing/`, ADR-005 D6 managed billing).
- "Reviewer invited" / "validation" already exists as the trust expert-validation workspace
  (`backend/src/trust/`, `access.py`, `membership_repo.py` — ADR-037).
- "Export" / "publish" map to `backend/src/export/`.

Per the doc's own instruction ("report any conflict... before choosing a different design"):
this spec resolves the conflict by keeping the **canonical event names and enums verbatim**
(per the doc's own non-negotiable) while mapping each event to its real Mentible call site in
the Instrumentation Map below. No event is renamed; only its trigger point is Mentible-specific.

## Data model

New alembic migration `0030` (current head is `0029_feedback_archived_at`), new module
`backend/src/analytics/` (peer to `trust/`, `billing/`, following the existing per-domain
layer-rule pattern: `backend/src/analytics/ → backend/src/core/`, no imports the other
direction).

### `analytics_event` (append-only)

One row per Common Event Contract event. Columns mirror the doc's Common Event Contract table:
`event_id` (UUID, PK), `event_name` (enum, canonical identifiers from the doc's Canonical Event
Catalog — preserved verbatim), `occurred_at` (UTC timestamp), `anonymous_id` (nullable string),
`user_id` (nullable string, FK-ish to account — nullable because pre-signup events have no
account row yet), `session_id`, `project_id` (nullable), `journey_stage` (enum, the stage at
time of processing), `use_case`, `content_type`, `plan_id`, `acquisition_source`, `device_class`
(enum), `experiment_variant`, `success` (bool, nullable), `error_code` (nullable),
`duration_ms` (nullable int), plus a `properties` JSONB column for the event-specific fields
from the catalog's "Event Properties" column (e.g. `output_word_count`, `transaction_id`) —
narrower than one column per possible property across 30 event types, and matches the
project's existing pattern of JSONB for variable per-type payloads (e.g. `trust` artifact
content).

**Privacy enforcement at the schema boundary:** the Pydantic ingestion schema
(`backend/src/analytics/schemas.py`) rejects any event whose `properties` payload contains keys
matching a denylist (`manuscript`, `prompt`, `source_text`, `reviewer_comment`, `email`,
`card`, `payment_method` — extensible) or values matching an email-shaped regex. This is the
enforcement point for AC9. `user_id` is the internal account id, never the email — same
identifier the rest of the backend already uses (`Principal`).

### `journey_state` (one row per user, upserted)

Mirrors the doc's Measurement Model table exactly: `user_id` (PK), `current_journey_stage`
(enum: `discover_join | create_first_value | refine_validate | finish_pay | return_advocate`),
`stage_status` (enum: `not_started | in_progress | stalled | completed`),
`last_meaningful_event` (string), `last_meaningful_event_at` (UTC timestamp, nullable),
`stall_reason` (enum, nullable — sub-project 2 populates this; column exists now so sub-project
2 doesn't need its own migration), `stalled_at` (nullable), `intervention_status` (enum,
nullable — same reasoning), `next_best_action` (nullable string), `resumed_at` (nullable).

Sub-project 1 only writes `current_journey_stage`, `stage_status` (`not_started` /
`in_progress` / `completed` — never `stalled`, that's sub-project 2's write), and
`last_meaningful_event(_at)`. The stall/intervention columns are provisioned but unused here.

## Components

- **`backend/src/analytics/models.py`** — `AnalyticsEvent`, `JourneyState` SQLAlchemy models +
  `EventName`, `JourneyStage`, `StageStatus` Python enums with values exactly matching the
  source doc's canonical identifiers.
- **`backend/src/analytics/schemas.py`** — Pydantic request/response schemas implementing the
  Common Event Contract, with the privacy denylist validator described above.
- **`backend/src/analytics/repo.py`** — `record_event(...)`, `get_journey_state(user_id)`,
  `merge_anonymous_into_user(anonymous_id, user_id)`.
- **`backend/src/analytics/journey.py`** — pure function
  `evaluate_journey_state(events: list[AnalyticsEvent]) -> JourneyStateFields`. No DB
  dependency; rebuildable from full event history (AC2/AC4, and the doc's explicit requirement
  that stage logic "can be rerun against event history"). Stage-advancement rules come straight
  from the doc's Journey Stage Requirements table — e.g. `create_first_value` only completes on
  `meaningful_action_completed` with `action_type` in `{edit, save, approve, continue}`, never on
  `generation_completed` alone (the doc's Primary Activation Decision, and AC3).
- **`backend/src/analytics/router.py`** — `POST /api/v1/analytics/events` (batched ingestion,
  for client-originated events like `sample_viewed`, `pricing_viewed`). Server-confirmed events
  (signup, generation, export, checkout, review) are NOT posted over HTTP from the client — they
  call `record_event()` directly, in-process, from the endpoint that confirms the durable
  outcome. This satisfies the doc's "durable outcomes must be confirmed by the server, not
  inferred from a button click" rule (the closing "Claude MUST NOT" list, and AC1).

## Instrumentation map (canonical event → Mentible call site)

Only the server-confirmed events sub-project 1 wires up now; the rest of the catalog's schema
exists but emission is deferred to whoever owns that client surface:

| Canonical event | Mentible call site |
|---|---|
| `signup_completed` | `backend/src/auth/` — first successful JWT-verified request that creates an account row (`get_or_create_account`) |
| `generation_completed` / `generation_failed` | `backend/src/trust/generate.py`, `generate_topic.py` — after the Anthropic/Groq call resolves |
| `meaningful_action_completed` | `backend/src/trust/` draft edit/save/approve/continue endpoints — `action_type` from the doc's Meaningful Action Rules |
| `review_completed` | `backend/src/trust/approval_repo.py` path — reviewer submits an approval record |
| `export_completed` / `export_failed` | `backend/src/export/` |
| `checkout_completed` / `checkout_failed` | `backend/src/billing/` — RevenueCat webhook handler (`revenuecat.py`) |
| `second_project_created` | `backend/src/trust/project_repo.py` — project creation, when the account already owns ≥1 prior project |

## Error handling

`record_event()` calls inserted at existing endpoints are wrapped so an analytics failure never
fails the primary operation — logged as a structlog warning (event_name + error, key-redacted
per existing logging rules) and swallowed at that call site only. The `POST /analytics/events`
endpoint is the one path where failure is surfaced to the caller (400 on schema/privacy-denylist
violation), since it's the client's own explicit call and the client can retry/drop it.
`evaluate_journey_state()` is pure and deterministic — a wrong result there is a bug to fix, not
a runtime condition to handle defensively.

## Testing

- Schema/privacy tests: assert the denylist rejects manuscript/prompt/reviewer-comment/email/
  payment-shaped payloads (AC9).
- `evaluate_journey_state()` unit tests, table-driven off the doc's Journey Stage Requirements
  table — one case per stage transition, plus the negative case (generation without a
  meaningful follow-up action does NOT activate — AC3).
- Anonymous-merge integration test: events recorded pre-signup under `anonymous_id` are
  attached to the account at `signup_completed` without duplication (AC2).
- One test per instrumented call site asserting the event fires with the correct
  `event_name`/properties when that endpoint's durable outcome occurs, and does NOT fire on
  failure paths that don't represent the outcome (e.g. no `checkout_completed` on a declined
  webhook).
- No live Anthropic/Redis/RevenueCat in CI, per existing test rules — mock at the boundary.

## Out of scope (future sub-projects, not this spec)

- Stall detection, configurable thresholds, `stall_reason`/`intervention_status` writes.
- The human-approved follow-up email pipeline (`followup_*` table, review queue, send service).
- Dashboards/metrics queries.
- Client-side instrumentation for pure-UI events (`landing_viewed`, `sample_viewed`,
  `pricing_viewed`, etc.) — schema defined, emission deferred.
- Resolving the doc's "Open Product Decisions" (analytics platform, paywall rules, email
  provider, consent model) — none of them block this sub-project.
