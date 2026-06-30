# Managed-key rotation runbook (ADR-005 D6, Phase 6)

How to rotate the **managed provider keys** (OUR company keys held server-side — the
"vault", `backend/src/billing/vault.py`). These are *our* secrets, billed to *us*, and
serve every managed user — so rotate on the usual cadence and immediately on any
suspected exposure.

> These are **not** BYOK keys. BYOK keys are the user's, device-local, never persisted
> (ADR-001). This runbook is only for the `MANAGED_*_API_KEY` company keys.

## When to rotate
- Scheduled hygiene (e.g. quarterly).
- **Immediately** if a key may have leaked (a `managed_*` value in a log/paste, a laptop
  loss, a contractor offboarding) or if `managed_spend_alarm` / `managed_spend_ceiling_hit`
  fires unexpectedly (possible abuse — investigate first, rotate if compromise is likely).

## Steps (per provider)
1. **Mint a new key** in the provider console (Anthropic / OpenAI / Groq / Gemini),
   scoped/limited where the provider allows.
2. **Set it** in the prod backend env (`MANAGED_<PROVIDER>_API_KEY`) — same discipline as
   `BYOK_MASTER_KEY` / `SYSTEM_OWNER_SECRET`: env/secret only, never committed, never
   logged. Apply via the ROOT prod refresh (`Plans/PROD_BACKEND_REFRESH_TO_MAIN.md`).
3. **Restart** the backend so the new key loads (the vault reads `settings` at call time;
   a fresh process is the clean way to pick up an env change).
4. **Verify** a managed generation succeeds on that provider (an internal staff-allowlist
   account is the safe test path).
5. **Revoke the old key** in the provider console once the new one is confirmed live.
6. **Audit**: confirm no `managed_*` value appears in logs (the no-key-in-logs gate covers
   the request path; the rotation itself touches only env + the provider console).

## Margin / spend monitoring (Phase 6)
- **Per-account backstop:** `MANAGED_ACCOUNT_SPEND_CEILING_MICROS` (O7) blocks a runaway
  account before it drains spend, independent of its plan; `MANAGED_SPEND_ALARM_FRACTION`
  emits a `managed_spend_alarm` log at that fraction of the effective limit.
- **Aggregate margin:** `GET /api/v1/admin/billing/usage-summary?days=N` (super-admin) returns
  total managed `cost_micros` + events + distinct accounts over the window — the data an
  operator watches against subscription revenue. (A UI dashboard on top is a later nicety.)
