# ADR-001: BYOK Security Model — Pattern B (Per-Request Passthrough)

| | |
|---|---|
| **Status** | Accepted — 2026-04-25 · **Amended by ADR-005 (2026-05-29)** |
| **Decision-maker** | Sivakumar Mambakkam |
| **Supersedes** | — |
| **Superseded by** | — |

> **Amendment (ADR-005, 2026-05-29) — key handling is now HYBRID.** This ADR's
> Pattern B (per-request passthrough) is **retained in full for the optional BYOK
> path**. A second, default **managed** path was added: we hold *our own* provider
> keys in an at-rest secrets vault (rotated, never logged) and bill tokens via the
> subscription. The two regimes coexist. The non-negotiable rule is unchanged and
> now covers both: **no key — the user's or ours — ever reaches a log line, DB
> row, or traceback.** Everything below describes the **BYOK path**; see ADR-005
> for the managed-vault path.

---

## Context

StudyBuddy Q is a Bring-Your-Own-Key (BYOK) product (decision **D1**): the
end-user supplies their own Anthropic API key, the app calls Anthropic on the
user's behalf, and the user is billed directly by Anthropic. The app developer
has zero token-cost exposure.

Decision **D2** specifies async generation with a backend completing the work
and pushing results to the device. This means **the backend must touch the
user's API key** even though the BYOK model says "directly pay Anthropic."

Three patterns were considered (SCOPE.md §6.1):

| Pattern | Where the key lives |
|---|---|
| A. Server-side stored | Backend stores encrypted, used for every request |
| **B. Per-request passthrough** | Mobile holds key, sends with each request, backend uses + discards |
| C. Client-side direct | Mobile calls Anthropic directly; backend never sees keys |

Pattern C conflicts with D2 (we need a backend to do the async work). Pattern A
has the cleanest UX but introduces a serious liability — we'd be storing
third-party AI provider credentials at scale, taking on encryption-at-rest,
key-rotation, breach-disclosure, and audit obligations.

---

## Decision

**We adopt Pattern B — per-request passthrough.** The user's Anthropic API key:

1. Lives **on the device** in `expo-secure-store` (Android Keystore-backed)
2. Is sent with every `/generate` request in the **HTTPS request body**
3. Is **encrypted at rest** in Redis with a per-job ephemeral key for the
   duration of the async job (≤ TTL)
4. Is **read once** by the Celery worker, used for the Anthropic API call,
   then **shredded** from process memory and **deleted** from Redis
5. Is **never written** to Postgres, S3, structured logs, exception tracebacks,
   or any persistent store

The backend retains a relationship with `(user, job, success/failure, duration,
job_id)` — but never `(user, key)`.

---

## Threat model

### What we protect against

| Threat | Mitigation |
|---|---|
| **HTTPS interception in transit** | TLS 1.2+ enforced on all endpoints; HSTS preload |
| **Key in server logs** | structlog redaction filter (mandatory in processor chain); regex match on `sk-ant-*` patterns; CI test that proves no log line in any code path contains the test key |
| **Key in exception tracebacks** | Exception-scrubber middleware that walks the traceback locals and redacts keys; `repr()` of any object holding the key is scrubbed |
| **Key in Postgres / S3 / disk** | Architectural rule: the key never leaves the request-handler / queue-message / worker-process memory triangle. Code review + grep CI |
| **Long-lived key in Redis after job completion** | TTL enforced at write time (default 120 s); worker explicitly DELs the key on success and on failure paths |
| **Server breach exposing Redis snapshot** | Per-job encryption envelope: actual key material is encrypted with a job-scoped ephemeral key derived from `(server_master_key, job_id)`. A Redis dump alone yields ciphertext only |
| **Malicious operator running `MONITOR` on Redis** | Same as above — ciphertext in Redis. Master key access logged to a separate audit channel |
| **Replay attack reusing an old request body** | Each `/generate` includes a request_id (UUIDv4); idempotency table tracks last 24 h of (user, request_id); duplicates rejected |
| **CSRF on /generate** | Session JWT (Bearer auth at v1.1+); SameSite + Origin checks; never a cookie auth on this endpoint |

### What we do NOT protect against

| Threat | Why out of scope |
|---|---|
| **Compromised user device** | If malware reads `expo-secure-store`, the user has bigger problems. We rely on the OS-level keystore. Out of our threat model |
| **User pastes their key into a fake app** | We are the mobile app. A malicious clone is a Play Store / brand problem, not an architecture problem |
| **User's Anthropic account being stolen via phishing** | Out of scope — Anthropic's auth posture, not ours |
| **TLS root CA compromise** | Industry-wide problem; cert pinning is a v1.1+ consideration, not MVP |
| **Side-channel attacks on the worker process during the Anthropic call** | Not in our threat model for an MVP — we trust the host kernel |

---

## Implementation contract

### Transport — `POST /generate`

```
POST /generate HTTP/2
Host: api.studybuddyq.app
Authorization: Bearer <session_jwt>            ← OUR token (v1.1+); MVP can omit
Content-Type: application/json

{
  "request_id": "5e4f3a2b-...",                ← idempotency key
  "topic": "Quadratic formula",
  "level": "Standard",
  "format": "lesson",
  "language": "en",
  "api_key": "sk-ant-...",                     ← BYOK; NEVER in URL or header
  "model": "claude-sonnet-4-6"                 ← optional; defaults to pinned
}
```

**Forbidden alternatives:**
- ❌ `?api_key=...` (URL query — appears in access logs)
- ❌ `Authorization: Bearer sk-ant-...` (the user's key in *our* auth header — confuses session vs upstream auth)
- ❌ `X-Anthropic-Key: ...` (custom headers tend to leak into reverse-proxy logs)

### Server lifecycle

```
                    ┌─────────────────────────────────────┐
                    │ FastAPI handler /generate           │
                    │  - validates request body           │
                    │  - generates ephemeral_key          │
                    │  - encrypts api_key with it         │
                    │  - writes to Redis: SETEX           │
                    │       byok:{job_id} 120 <ciphertext>│
                    │  - dispatches Celery job(job_id,    │
                    │       ephemeral_key)                │
                    └─────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │ Celery worker                       │
                    │  - GET byok:{job_id}                │
                    │  - decrypt with ephemeral_key       │
                    │  - call Anthropic with key          │
                    │  - explicit DEL byok:{job_id}       │
                    │  - overwrite key var with bytes(0)  │
                    │  - return result via job-result key │
                    └─────────────────────────────────────┘
```

Two distinct keys live in the system:

| Key | Where | Lifetime |
|---|---|---|
| `server_master_key` | Env var `BYOK_MASTER_KEY` (32 bytes, Hex) | Until rotation |
| `ephemeral_key` (per-job) | Derived: `HKDF(server_master_key, salt=job_id)`. Held in Celery task arg | Lifetime of the job (≤ TTL) |
| `api_key` (user's Anthropic key) | Encrypted in Redis at `byok:{job_id}` until decrypted in worker | ≤ 120 s |

**Why two keys:** a Redis snapshot alone yields ciphertext. An attacker would
also need the `BYOK_MASTER_KEY` (env var, separate blast radius). Rotating
`BYOK_MASTER_KEY` invalidates all in-flight jobs; this is acceptable because
TTL is 120 s.

### Logging discipline

```python
# backend/src/core/log_redaction.py  (sketch — implementation in ADR-001 PR)
import re, structlog

ANTHROPIC_KEY_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]{32,}")

def redact_keys(_, __, event_dict):
    for k, v in list(event_dict.items()):
        if isinstance(v, str) and ANTHROPIC_KEY_RE.search(v):
            event_dict[k] = "<redacted-anthropic-key>"
        if k in {"api_key", "anthropic_key", "byok_key"}:
            event_dict[k] = "<redacted>"
    return event_dict

structlog.configure(processors=[redact_keys, structlog.processors.JSONRenderer()])
```

**CI gate (mandatory):**

```bash
# tests/test_no_key_in_logs.py — runs on every PR
def test_no_key_in_logs(caplog):
    test_key = "sk-ant-" + "x" * 64
    # exercise every code path: validate, queue, worker mock, error path
    ...
    for record in caplog.records:
        assert test_key not in record.getMessage()
        assert test_key not in str(record.args)
```

### Audit posture

We DO record (in our database / audit log):
- `job_id`, `request_id`, `user_id` (v1.1+)
- Submission time, completion time, duration
- Success / failure status; error class on failure (NEVER error message text — may contain key fragments)
- Token-count returned by Anthropic (for user-side reporting)
- Model used

We DO NOT record:
- The API key (any portion)
- The full prompt sent to Anthropic (may be useful for debugging, but is the user's content; defer to v1.1+ with explicit user opt-in)
- The response body verbatim (stored only in user's library, not in audit logs)

### Mobile-side rules

- API key entered in Settings → written via `SecureStore.setItemAsync()` only
- Read on demand for the next `/generate` call; never cached in component state beyond the request
- **Never** sent to any host other than `api.studybuddyq.app`
- **Never** logged via `console.log()` (lint rule + redaction wrapper)
- Settings screen displays last-4 only: `sk-ant-...XYZ8`

---

## Consequences

### Positive

- **Zero long-term liability** for storing AI provider credentials
- Server breach exposes ciphertext-only key material with a 120 s TTL
- BYOK economics work cleanly — we never see Anthropic bills
- Compliance posture is simple: we are not a token reseller

### Negative

- **UX cost:** every device the user installs on requires re-pasting the key. This is the single biggest friction point at first launch
- **Operational cost:** key-redaction discipline must be enforced perpetually — one careless `logger.info(f"req={req.dict()}")` undoes the entire model
- **Recovery cost:** if a user reports "I think my key leaked," our forensic answer is "we don't have it; check Anthropic's audit log." Polite but unhelpful — accepted
- **Cannot offer streaming progress** of the Anthropic response back to the device cheaply, because the key is held server-side per-job. Fine — D12 says minutes-not-seconds anyway

### Neutral

- Future migration to Pattern A (stored key, opt-in) remains possible: it would only add a "Save my key" toggle in Settings + a server-side encrypted-store table. The existing Pattern B pathway stays the default

---

## Alternatives considered

### Pattern A — Server-side stored key

Rejected at MVP. Best UX (paste once), but stores third-party AI credentials at
rest. Requires:
- Per-user envelope encryption (KMS or libsodium sealed box)
- Key rotation policy
- Breach-notification process
- Customer-facing key-management UI (delete key, see last-used time)

May be revisited as a v2 *opt-in* feature for users who want one-tap convenience
across devices. The default would remain Pattern B.

### Pattern C — Client-side direct (mobile → Anthropic)

Rejected because it conflicts with D2 (async backend completes work + pushes
result). Generation needs to survive the user backgrounding the app — Android's
process killer would terminate a long-running on-device call. Also makes the
"AI picks the right visual" prompt step (D14) harder, because that's a
multi-step pipeline best done server-side.

May become viable if a future Anthropic OAuth flow appears, scoped tokens
replace bare keys, and on-device generation becomes reliable on background
Android (`expo-task-manager` is fragile). Watch the space.

### Pattern D — Anthropic OAuth (hypothetical)

Anthropic does not currently offer OAuth for the API. If they ship it, this ADR
would be revisited: scoped, short-lived tokens largely eliminate the threat
model around stored or transmitted master keys. Until then, bare API keys are
the only option.

---

## Compliance & operations

| Concern | Response |
|---|---|
| **GDPR — is the API key personal data?** | Yes (a credential associated with a natural person). We process it transiently as a data processor for the user. Privacy notice will document the per-request processing model and the no-storage commitment |
| **PCI / SOC 2** | Not in scope at MVP. SOC 2 readiness is a v2+ consideration if we ever revisit Pattern A |
| **Anthropic ToS** | The user's relationship with Anthropic is direct (BYOK). We are not a reseller. We comply with Anthropic's API ToS as a developer building tooling |
| **Incident response** | If `BYOK_MASTER_KEY` is suspected compromised: rotate immediately, in-flight jobs fail (acceptable per 120 s TTL), affected users notified that *no API key data was at risk* (because Redis ciphertext alone yields nothing), but key-rotation is best-practice |

---

## Review

This ADR will be re-reviewed:
- Before any code that handles the API key is merged
- Before public alpha release
- If Anthropic ships OAuth or scoped tokens
- If we ever consider Pattern A again as an opt-in

Changes require a new ADR (ADR-001-revision or supersede), not edits to this
document.
