# Trust/Validation Data Model — Design Spec

**Status:** Approved (2026-07-27) · **Sub-project (b) of [ADR-037](../../adr/ADR-037-reposition-to-expert-validation-studio.md)** (SME expert-validation pivot, PR #341).
**Scope of this spec:** the **backend persistence layer** for the four-phase workflow's data — projects, captured inputs, generated artifacts + revision history, feedback, and expert-approval records — plus the **share-ready access seam** (ADR-037 D4). **Persistence only: migration + models + repos + access-guard + repo tests. No API routers, no UI** (those are later sub-projects).

## Why this sub-project first
Everything downstream (derivatives, expert-login, services ops) reads/writes this data and passes through the access-guard seam. Getting the model + seam right unblocks the rest. Per ADR-037 D4 the **seam is non-negotiable here**: build ownership + a single access-guard now so a future expert-login (sub-project c) is *add one table + extend one function*, not a 200-endpoint retrofit.

## Grounding — existing backend idiom (follow it exactly)
Raw **asyncpg + Alembic** (hand-written `op.execute` SQL migrations, chained `revision`/`down_revision`); **no runtime ORM**. `uuid` PKs `DEFAULT gen_random_uuid()`; enums as `text + CHECK` mirrored by a Python tuple validated in the repo; `timestamptz` `created_at`/`updated_at DEFAULT now()`; FKs `... REFERENCES account(id) ON DELETE CASCADE`; metadata-in-DB + **blobs-on-disk** (`src/library/artifact_store.py`) for large binaries; per-domain `repo.py` of `async def fn(conn, *, ...)` returning frozen dataclasses, SQL as `$1` positional params (never f-string). Access resolved in the router via `require_active_user` (`src/accounts/deps.py`). Tests hit a **real migrated Postgres**, one transaction per test rolled back, `skipif(not DATABASE_URL)`. Latest migration = `0008_draft_sharing`; this adds **`0009`**.

## Global Constraints
- Single migration `backend/alembic/versions/0009_trust_validation.py`, `down_revision = "0008"`, raw `op.execute` SQL.
- All new domain code under `backend/src/trust/`.
- Scoping key = **`owner_account_id uuid REFERENCES account(id) ON DELETE CASCADE`** on `project` only; children scope through the FK chain. (Chosen over `owner_sub text`: FK integrity + GDPR cascade purge (ADR-014 D8) + clean future `project_membership` FK.)
- Enums are `text + CHECK (...)` + a Python tuple constant validated in the repo before insert.
- `approval` is **append-only** — the repo exposes insert + read, **never update/delete**.
- No API routers or UI in this sub-project.

---

## Data model

### `project` — one SME knowledge project

| column | type | notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `owner_account_id` | `uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE` | **the ownership anchor** |
| `title` | `text NOT NULL` | |
| `topic` | `text` | new-project wizard |
| `audience` | `text` | |
| `goal` | `text` | |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))` | |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` bumped on upsert |

Index: `project_owner_idx ON project(owner_account_id)`.

### `project_input` — captured raw material

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `project_id` | `uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE` | |
| `kind` | `text NOT NULL CHECK (kind IN ('transcript','note','upload','link'))` | |
| `title` | `text` | |
| `content` | `text` | pasted transcript/note body (MVP inputs are **pasted text** — direction §12: uploads are a later step) |
| `source_ref` | `text` | original filename / URL |
| `storage_path` | `text` | **reserved** for the upload path (blob-on-disk); null at MVP |
| `content_hash` | `text` | reserved, blob-split |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index: `project_input_project_idx ON project_input(project_id)`.

### `artifact` — a generated output container (versions hang off it)

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `project_id` | `uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE` | |
| `role` | `text NOT NULL CHECK (role IN ('cornerstone','derivative'))` | one cornerstone master + derivatives |
| `format` | `text NOT NULL CHECK (format IN ('book','guide','learning_module','podcast','youtube','reel','linkedin','x_thread'))` | |
| `title` | `text` | |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index: `artifact_project_idx ON artifact(project_id)`.

### `artifact_version` — immutable revision history

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `artifact_id` | `uuid NOT NULL REFERENCES artifact(id) ON DELETE CASCADE` | |
| `version_no` | `integer NOT NULL` | monotonic per artifact |
| `content` | `jsonb NOT NULL` | the generated draft (structured; mirrors `shared_draft.book_json` idiom). For book-length cornerstone (≤25k words ≈ ~150KB) jsonb is fine. |
| `generation_meta` | `jsonb` | provider/model/prompt-ref; links conceptually to `usage_event` |
| `created_by_sub` | `text NOT NULL` | operator who generated it |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

Constraints: `UNIQUE (artifact_id, version_no)`. Index: `artifact_version_artifact_idx ON artifact_version(artifact_id)`. **Immutable**: a revision creates a new row (next `version_no`), never an update.

### `artifact_version_source` — version-level traceability (join)

| column | type | notes |
|---|---|---|
| `version_id` | `uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE` | |
| `input_id` | `uuid NOT NULL REFERENCES project_input(id) ON DELETE CASCADE` | |

PK: `(version_id, input_id)`. Realizes "this draft draws on transcript A, deck B" with FK integrity. (Coarse per approval; a future claim-level citations table can attach to versions without reworking this.)

### `feedback` — expert comments driving revisions

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `version_id` | `uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE` | |
| `author_kind` | `text NOT NULL CHECK (author_kind IN ('expert','operator'))` | expert feedback is **recorded by the operator** (D4) |
| `author_name` | `text` | expert name as data |
| `body` | `text NOT NULL` | |
| `recorded_by_sub` | `text NOT NULL` | operator who logged it |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index: `feedback_version_idx ON feedback(version_id)`.
**Reconciliation with `0008`:** deliberately **separate** from `draft_comment` (0008's share-a-draft-link flow, `owner_sub`/`book_json`). Different aggregate root (project-workspace vs shared-draft). Documented boundary; the two comment stores are **not** merged and neither becomes a generic comment service.

### `approval` — append-only expert-approval record

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `version_id` | `uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE` | approval attaches to a **specific version** |
| `expert_name` | `text NOT NULL` | |
| `expert_email` | `text` | |
| `expert_role` | `text` | the authority ("civil engineer, 20y stormwater") |
| `approved_at` | `timestamptz NOT NULL` | when the expert approved (may precede recording) |
| `recorded_by_sub` | `text NOT NULL` | operator who recorded it |
| `recorded_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `note` | `text` | |

Index: `approval_version_idx ON approval(version_id)`. **Append-only** — repo exposes insert + read only; no update/delete path exists.
**Trust rule:** a version is "expert validated" **iff an `approval` row exists for it**. Nothing is labelled validated before that (ADR-037 guiding principle; enforced at read time, not stored as a mutable flag).

### `usage_event` (existing, `0005`) — optional touch
Generations are metered here already. **Optional, flagged:** add nullable `project_id uuid REFERENCES project(id) ON DELETE SET NULL` to attribute a generation to a project. Deferred unless the plan finds it trivial; not required for this sub-project.

---

## The access-guard seam (ADR-037 D4)

New module `backend/src/trust/access.py`:

```python
PROJECT_ROLES = ("owner",)  # extended with "reviewer" when expert-login lands (sub-project c)

class ProjectAccessError(Exception): ...  # router maps to 403

async def require_project_access(
    conn: asyncpg.Connection, *, account_id: uuid.UUID, project_id: uuid.UUID
) -> str:
    """Return the caller's role on the project, or raise ProjectAccessError.
    MVP: owner-only. The ONE place project authorization is decided."""
    row = await conn.fetchrow(
        "SELECT owner_account_id FROM project WHERE id = $1", project_id
    )
    if row is None or row["owner_account_id"] != account_id:
        raise ProjectAccessError(str(project_id))
    return "owner"
```

- **Every** project-scoped repo operation resolves access through this function first. No inline ownership checks scattered per query.
- **Future (sub-project c):** add `project_membership(project_id, account_id, role)` and one `OR` branch here (`... OR EXISTS (SELECT 1 FROM project_membership ...)`). Endpoints and child repos are untouched.
- Composes with `require_active_user` (resolves `account` from the JWKS `Principal`) in future routers — but routers are out of scope here.

---

## Repository layer (`backend/src/trust/`)
Follow the per-domain `repo.py` idiom (async funcs taking `conn`, returning frozen dataclasses, `$1` params, `ON CONFLICT` upserts where apt):
- `models.py` — frozen dataclasses (`Project`, `ProjectInput`, `Artifact`, `ArtifactVersion`, `Feedback`, `Approval`) + enum tuple constants (`PROJECT_STATUSES`, `INPUT_KINDS`, `ARTIFACT_ROLES`, `ARTIFACT_FORMATS`, `FEEDBACK_AUTHOR_KINDS`).
- `project_repo.py` — `create_project`, `get_project`, `list_projects(account_id)`, `set_status`; `add_input`, `list_inputs(project_id)`.
- `artifact_repo.py` — `create_artifact`, `list_artifacts(project_id)`, `create_version` (auto-increment `version_no`), `list_versions(artifact_id)`, `add_version_sources`, `list_version_sources(version_id)`.
- `feedback_repo.py` — `add_feedback`, `list_feedback(version_id)`.
- `approval_repo.py` — `record_approval` (insert only), `get_approval(version_id)`, `is_validated(version_id) -> bool`. **No update/delete.**
- `access.py` — the guard above.

Enum values validated against the Python tuple in the repo before insert (raise `ValueError`), mirroring `entitlement_repo`/`provider_credential`.

---

## Testing (`backend/tests/`)
House pattern: real migrated Postgres, one transaction per test rolled back, `pytest.mark.skipif(not DATABASE_URL)`. Files:
- `test_trust_project_repo.py` — create project (owner set), list scoped by account, add/list inputs, archive.
- `test_trust_artifact_repo.py` — create artifact (role/format validated), create versions (monotonic `version_no`, `UNIQUE` enforced), link + list sources, immutability (no update path).
- `test_trust_feedback_repo.py` — add/list feedback, `author_kind` CHECK.
- `test_trust_approval_repo.py` — record approval, `is_validated` flips true only after a row exists, append-only (no update/delete fn exists).
- `test_trust_access.py` — `require_project_access` returns `"owner"` for owner, raises `ProjectAccessError` for a different account and for a missing project.
Enum-rejection tests (invalid `format`/`kind`/`status` raise `ValueError` in the repo before hitting the DB CHECK).

## Out of scope (later sub-projects)
- API routers / endpoints (compose `require_active_user` + `require_project_access`).
- Mobile/web UI (project workspace, approval capture, revision viewer).
- Generation itself (derivatives = #338; this stores versions, doesn't create them).
- Expert-login / `project_membership` (sub-project c — the seam is *ready*, not built).
- File uploads for inputs (columns reserved; MVP inputs are pasted text).
- Claim-level citations (version-level only; upgrade path noted).
- Cryptographic approval signing (append-only data record only, per brainstorm).

## Open items (resolve in the plan, non-blocking)
1. Whether to include the `usage_event.project_id` column now (only if trivial).
2. `content` jsonb shape for `artifact_version` — align with the compiler's book JSON where the format is `book`/`guide`; free-form for social formats. The plan can leave `content` opaque jsonb and defer shape to the generation sub-project.
