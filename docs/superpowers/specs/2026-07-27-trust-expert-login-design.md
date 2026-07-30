# Trust — Expert-Login (Multi-Actor Access) — Design Spec

**Status:** Approved (2026-07-27) · **Sub-project (c) of [ADR-037](../../adr/ADR-037-reposition-to-expert-validation-studio.md).**
**Builds on:** sub-project (b) ([PR #342](https://github.com/wegofwd2020-hub/Mentible/pull/342), branch `feat/trust-validation-data-model`) — this branch is cut from it; the diff includes (b) until (b) merges.
**Scope:** the **authorization model + logic** that lets a named expert log in and gain scoped **reviewer** access to one project — `project_membership` + email `project_invitation` + the redeem-on-login bridge + the guard extension + the carry-forward resolvers, plus an approval-provenance signal. **Persistence + logic only: NO HTTP router, NO UI, NO IdP wiring** (those compose these functions later).

## Why now (and the deferral it lifts)
ADR-037 D4 deferred expert-login as the single-tenant-breaking piece. This sub-project builds it deliberately: a second actor (the expert) on one operator's project = per-project membership + access. It stays **app-level** (extends `require_project_access`), **not** Postgres RLS (ADR-037 D6), and **not** the `user_roles`/`has_role` model the Lovable direction proposed. It also pays off the (b) whole-branch-review carry-forward (the `project_id_for_{artifact,version}` resolvers).

## Grounding — reuse, don't reinvent
- **Invite precedent:** `0008` draft-sharing (`draft_invitation`) is **email-only, no token/link, no accept step, soft-revoke** (`revoked_at`), `UNIQUE(book_id, invited_email)`; access resolved by matching the caller's login `email` (lowercased) against active invites (`backend/src/sharing/repo.py` `draft_access`/`add_invitation`). We mirror its shape.
- **Account on first login:** `get_or_create_account(conn, *, idp_sub, email)` (`backend/src/accounts/repo.py`) idempotently mints the `account` row on first use and returns `account.id` (uuid) — the hook a membership hangs on.
- **Identity:** `Principal{sub, email, issuer, is_super_admin}` (`backend/src/auth/principal.py`); `email` is a convenience claim, `sub` is the identity. Endpoints resolve the account via `require_active_user` → `get_or_create_account`.
- **(b) layer we extend:** `require_project_access(conn, *, account_id, project_id) -> str` (owner-only; its docstring names this task); `approval_repo.record_approval(...)` (operator-recorded, `recorded_by_sub` + `expert_name` as data); no `project_membership`, no resolvers yet.
- **Difference from draft-sharing:** draft-sharing re-matches email on *every* request and never touches `account`. We **materialize** a durable `project_membership` on `account.id` at login (role-bearing, the access.py TODO), keeping the guard a fast membership lookup.

## Global Constraints
- Single migration `backend/alembic/versions/0010_trust_membership.py`, `down_revision = "0009"`, raw `op.execute` SQL (split per-statement — asyncpg can't run multi-statement in one `execute`).
- All new code under `backend/src/trust/`. Tests `backend/tests/test_trust_*.py`.
- Membership scopes on `account_id uuid REFERENCES account(id) ON DELETE CASCADE`; invitations are email-keyed (the invitee may have no account yet).
- Enums `text + CHECK` + a Python tuple validated in the repo before insert.
- Emails stored **lowercased** (match draft-sharing).
- App-level authorization only — **no RLS, no `user_roles`/`has_role`**.
- ruff is at `~/.local/bin/ruff` (NOT in `backend/.venv`); the `"src/trust/*_repo.py" = ["S608"]` per-file-ignore already covers new repos.
- DB tests skip without `DATABASE_URL`; the test DB is already migrated to `0009`.

---

## Data model (migration `0010`)

### `project_membership` — durable per-project role on an account

| column | type | notes |
|---|---|---|
| `project_id` | `uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE` | |
| `account_id` | `uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE` | membership hangs on the account |
| `role` | `text NOT NULL CHECK (role IN ('owner','reviewer'))` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

PK: `(project_id, account_id)`. Index: `project_membership_account_idx ON project_membership(account_id)` (for "my projects").

### `project_invitation` — email invite (mirrors `draft_invitation`)

| column | type | notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `project_id` | `uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE` | |
| `invited_email` | `text NOT NULL` | stored lowercased |
| `role` | `text NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer'))` | only reviewers are invited (owners are creators) |
| `invited_by_sub` | `text NOT NULL` | operator who invited |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `revoked_at` | `timestamptz` | soft-revoke; active = `revoked_at IS NULL` |

`UNIQUE (project_id, invited_email)`. Index: `project_invitation_email_idx ON project_invitation(invited_email) WHERE revoked_at IS NULL` (redeem lookup).

### `approval` — provenance column (ALTER of (b)'s table)

```sql
ALTER TABLE approval
  ADD COLUMN recorded_via text NOT NULL DEFAULT 'operator'
  CHECK (recorded_via IN ('operator','expert_self'));
```

`'operator'` = studio recorded it on the expert's behalf (the (b) model, and the default so existing rows/behavior are unchanged). `'expert_self'` = the authenticated reviewer recorded their own approval — the visible "authenticated expert approved" trust signal.

---

## The guard extension (`backend/src/trust/access.py`)

Extend `require_project_access` with **one** membership branch — endpoints and child repos are untouched:

```python
PROJECT_ROLES = ("owner", "reviewer")

async def require_project_access(conn, *, account_id, project_id) -> str:
    owner = await conn.fetchval(
        "SELECT owner_account_id FROM project WHERE id = $1", project_id
    )
    if owner is None:
        raise ProjectAccessError(str(project_id))
    if owner == account_id:
        return "owner"
    role = await conn.fetchval(
        "SELECT role FROM project_membership WHERE project_id = $1 AND account_id = $2",
        project_id, account_id,
    )
    if role is not None:
        return role
    raise ProjectAccessError(str(project_id))
```

### Carry-forward resolvers (same module)
So a future router feeds the guard one supported way (fixes the (b) review's Important note):

```python
async def project_id_for_artifact(conn, *, artifact_id) -> uuid.UUID | None:
    return await conn.fetchval("SELECT project_id FROM artifact WHERE id = $1", artifact_id)

async def project_id_for_version(conn, *, version_id) -> uuid.UUID | None:
    return await conn.fetchval(
        "SELECT a.project_id FROM artifact_version v "
        "JOIN artifact a ON a.id = v.artifact_id WHERE v.id = $1",
        version_id,
    )
```

---

## The email→account bridge (`backend/src/trust/membership_repo.py`)

`redeem_invitations_for(conn, *, account_id, email) -> list[Membership]` — the login hook. For every **active** invitation matching the (lowercased) email across all projects, create a `project_membership(project_id, account_id, role)` (idempotent — `ON CONFLICT (project_id, account_id) DO NOTHING`); return the memberships now held. Called on the expert's first authenticated request (wiring deferred — no trust router yet, same posture as (b)'s standalone guard).

Also in `membership_repo.py`:
- `invite(conn, *, project_id, email, invited_by_sub, role="reviewer") -> Invitation` — insert lowercased email; `ON CONFLICT (project_id, invited_email) DO UPDATE SET revoked_at = NULL, invited_by_sub = EXCLUDED.invited_by_sub, role = EXCLUDED.role` (re-invite reactivates). Validate `role` against `INVITE_ROLES`.
- `revoke(conn, *, project_id, email) -> None` — soft-revoke (`SET revoked_at = now()`).
- `list_invitations(conn, *, project_id) -> list[Invitation]`.
- `list_members(conn, *, project_id) -> list[Membership]`.

Models (in `models.py`): `Membership`, `Invitation` frozen dataclasses; tuples `MEMBERSHIP_ROLES=("owner","reviewer")`, `INVITE_ROLES=("reviewer",)`, `APPROVAL_VIA=("operator","expert_self")`.

## `approval_repo.py` change
Add `recorded_via: str = "operator"` param to `record_approval` (validated against `APPROVAL_VIA`); insert it. Default preserves (b)'s behavior and every existing caller/test. No update/delete added — approval stays append-only.

## Capability model (stated; enforced at future routers, out of scope here)
- **owner** (project creator): invite/revoke, edit, delete, approve (`operator`-recorded on an expert's behalf).
- **reviewer** (invited, logged-in expert): read project + versions, add feedback, record own approval (`expert_self`). Cannot invite, edit content, delete, or change membership.

The guard returns the role; enforcement of *what each role may call* lives in the routers built later.

---

## Testing (`backend/tests/`, live migrated PG, txn-rollback, skip without `DATABASE_URL`)
- `test_trust_membership_repo.py` — invite (insert + lowercase + reactivate-on-reinvite), revoke (soft), list_invitations, list_members.
- `test_trust_redeem.py` — `redeem_invitations_for`: an active email-invite → a membership with the invited role; revoked invite → no membership; idempotent on second login; email match is case-insensitive; unrelated-email invite → nothing.
- `test_trust_access.py` (extend (b)'s) — owner→"owner"; a member account→its role ("reviewer"); non-member, non-owner→raises; missing project→raises. Plus `project_id_for_artifact`/`project_id_for_version` resolve correctly (and return None for unknown ids).
- `test_trust_approval_repo.py` (extend (b)'s) — `record_approval` stores `recorded_via` for both `operator` (default) and `expert_self`; invalid value → `ValueError`.
- Migration smoke (extend `test_trust_schema.py`) — `project_membership`, `project_invitation` exist with the right PK/UNIQUE/FK-cascade; `approval.recorded_via` column + CHECK present.

## Out of scope (later sub-projects)
- HTTP router / endpoints (invite/revoke/list; composing `require_active_user` → account → `require_project_access`).
- Wiring `redeem_invitations_for` into the login/`require_active_user` path.
- Mobile/web UI (operator invites; expert signs in, reviews, approves).
- Real IdP end-to-end (Supabase) verification.
- More than two roles; per-artifact granularity; invitation expiry/emails-sent.

## Open items (resolve in the plan, non-blocking)
1. Whether `owner` ever appears as an explicit `project_membership` row, or ownership stays solely on `project.owner_account_id` (spec assumes the latter — owner is not a membership row; the guard checks ownership first, membership second). The `role` CHECK includes `'owner'` only for forward flexibility.
2. Whether `redeem_invitations_for` should also *revoke-consume* the invitation after materializing membership, or leave it active (spec leaves it active — re-running is idempotent and a membership already exists; revocation stays an explicit operator action).
