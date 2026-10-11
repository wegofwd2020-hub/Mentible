# Intervention email control (deferred)

**Status:** recorded 2026-10-11. Revisit later. No code yet.

## Current behaviour

- Intervention emails are **manual only**. No beat task or scheduler sends them.
- The only send path is the super-admin `POST /api/v1/analytics/interventions/send-stalled`, triggered by the **Re-send** button on `/settings/analytics`.
- Re-send rules:
  - Not-started users send immediately.
  - In-progress users wait for `intervention_retry_interval_days` (2 days) since the last send.
  - Refused once `max_intervention_attempts` (3) is reached.
- Only users with `journey_state.stalled_at` set appear on the page. Production stall detection does not set it (see the stall-detection gap in `docs/STATUS.md`), so only hand-marked users show.
- Sender: Gmail SMTP (`EMAIL_PROVIDER=smtp`), subject prefix `from Mentible: `.

## Deferred work

1. **Kill switch** `INTERVENTION_EMAILS_ENABLED`, default **off**. While off, every send is refused, including Re-send.
2. **Confirm prompt** on Re-send ("Send reminder to this user?") before the request fires.

## Why

The operator wants to control when real people get emailed. Stray clicks and the attempt cap are the only guards today.

## How to apply when revisiting

- Build both items above.
- Do not add automatic sending.
- Do not enable sends for any user without an explicit go-ahead from the operator.
