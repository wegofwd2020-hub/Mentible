"""Managed billing (ADR-005 D6) — Phase 1: the managed-key vault + eligibility.

Two deliberately separate layers (ADR-019 amendment, 2026-06-30):

- ``vault`` — the *mechanism*: access to OUR company provider keys. Identical across
  the wegofwd family and the future ``wegofwd-billing`` extraction candidate.
- ``eligibility`` — the *policy*: who may use the managed path. Per-app, stays here.

See ``docs/MANAGED_BILLING_BUILD_PLAN.md``.
"""
