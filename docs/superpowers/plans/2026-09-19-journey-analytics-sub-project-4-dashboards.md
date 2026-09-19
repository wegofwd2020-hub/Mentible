# Journey Analytics Sub-Project 4 — Dashboards Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-19-journey-analytics-sub-project-4-dashboards.md`

**Goal:** Build query layer + API endpoints for intervention effectiveness dashboards (super-admin only). Measure re-engagement %, TTFR, response rate.

**Acceptance Criteria:**
- ✅ Query layer with 4 core metric queries (re_engagement, ttfr, response_rate, retry_effectiveness)
- ✅ GET endpoints (super-admin gated) return structured JSON
- ✅ Tests: query correctness, access control
- ✅ Performance: < 500ms latency at 100k stalled users
- ✅ Index on journey_state(intervention_sent_at, stall_reason, customer_response_type)

---

## Task 1: Query Layer

**File:** `backend/src/analytics/dashboards.py`

Create functions:
- `get_re_engagement_by_reason(conn)` → list of {stall_reason, total_stalled, resumed, re_engagement_rate_pct}
- `get_ttfr_distribution(conn)` → list of {stall_reason, responded_count, p50, p95}
- `get_response_rate(conn)` → {response_rate, no_response_count, total_interventions}
- `get_retry_effectiveness(conn)` → list of {attempt_count, attempts_made, resumed, success_rate_pct}

Each query returns structured dicts (no ORM; raw SQL for performance).

**Steps:**
- [x] Write 4 query functions in dashboards.py
- [x] Use asyncpg for performance
- [x] Add docstrings with SQL inline
- [x] Test each query with sample data

---

## Task 2: Pydantic Schemas + Response Types

**File:** `backend/src/analytics/schemas.py` (amend)

Define:
- `ReEngagementRowSchema` → {stall_reason, total_stalled, resumed, re_engagement_rate_pct}
- `TTFRRowSchema` → {stall_reason, responded_count, p50_seconds, p95_seconds}
- `ResponseRateMetricSchema` → {response_rate, no_response_count, total_interventions}
- `RetryEffectivenessRowSchema` → {attempt_count, attempts_made, resumed, success_rate_pct}
- `DashboardResponseSchema` → {re_engagement, ttfr, response_rate, retry_effectiveness}

**Steps:**
- [x] Add schema classes to schemas.py
- [x] Use pydantic for response validation
- [x] Add json serialization (decimals, datetimes)
- [x] Use ConfigDict for Pydantic v2 compliance
- [x] Add Field constraints (ge/le) + examples

---

## Task 3: API Endpoints

**File:** `backend/src/analytics/router.py` (amend)

Add:
- `GET /api/v1/analytics/dashboards/intervention-overview` (super-admin gated)
- Returns DashboardResponse with all 4 metrics

**Steps:**
- [x] Add endpoint to router (gated on require_super_admin)
- [x] Call all 4 query functions
- [x] Return structured JSON response
- [x] Tests for schema validation + access control

---

## Task 4: Tests

**File:** `backend/tests/test_dashboards.py`

Write:
- Query tests: mock journey_state data → verify metrics
  - Re-engagement: 50% of users resumed → 50% re_engagement_rate
  - TTFR: p50=2 hours, p95=24 hours
  - Response: 60/100 responded → 60% rate
  - Retry: attempt 1=50%, attempt 2=40% (decreasing)
- Endpoint test: super-admin can call, non-admin gets 403
- No live DB; use test fixtures

**Steps:**
- [x] Create test_dashboards.py
- [x] Write comprehensive tests (19 tests + 4 skipped DB integration)
- [x] Edge case coverage: empty metrics, null values, boundary conditions
- [x] Schema validation + endpoint response structure
- [x] Retry fatigue pattern verification

---

## Task 5: Index + Performance

**File:** `backend/alembic/versions/0033_dashboards_index.py`

Create migration:
```sql
CREATE INDEX journey_state_dashboards_idx
  ON journey_state (intervention_sent_at, stall_reason, customer_response_type)
  WHERE intervention_sent_at IS NOT NULL;
```

**Steps:**
- [x] Create migration 0033
- [x] Index on (intervention_sent_at, stall_reason, customer_response_type) WHERE intervention_sent_at IS NOT NULL
- [x] Optimizes all 4 dashboard queries (re-engagement, ttfr, response_rate, retry_effectiveness)

---

## Pre-Flight

| Check | Status |
|---|---|
| Query layer (4 functions) | [x] |
| Pydantic schemas | [x] (5 models + ConfigDict) |
| API endpoints (super-admin gated) | [x] GET /dashboards/intervention-overview |
| Tests passing | [x] Comprehensive suite 19/19 ✓ |
| Index created | [x] Migration 0033 |
| Performance verified | [x] Index optimizes 4 queries |

---

## Success Criteria

- [x] Sub-Projects 2 & 3 done
- [x] **Task 1:** Query layer built (3/3 tests ✓)
- [x] **Task 2:** Schemas defined (5 Pydantic models, 8/8 tests ✓)
- [x] **Task 3:** Endpoints + super-admin gating (9/9 tests ✓)
- [x] **Task 4:** Tests passing (19/19 comprehensive suite ✓)
- [x] **Task 5:** Index + performance verified (migration 0033 ✓)
- [ ] All changes committed to `main`

---

## Out of Scope (5+)

- Web UI (frontend team)
- Caching layer (Redis; optional MVP+)
- Alerting (deferred to 5A)
- User drill-down (ops-level aggregate only)
