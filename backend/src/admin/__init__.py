"""Super-admin operator surface — ADR-020 D3.

The runtime admin console's backend. Every route is gated by `require_super_admin`
(ADR-020 D2) and exposes cross-account *metadata only* — never user-generated
content, never key material (D5; the deliberate, audited exception to single-tenant
isolation, D3.1). Ticket #2 covers user management; plans/library/metrics arrive in
later tickets.
"""
