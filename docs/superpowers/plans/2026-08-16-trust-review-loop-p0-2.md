# P0-2 Trust Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the ADR-037 review loop — inline section comments, a version diff, and reviewer/editor roles.

**Architecture:** Three independent slices. (A) `feedback` gains a nullable `section_index` so a comment pins to one section of an immutable version; the mobile version viewer grows a per-section comment control. (B) a pure client-side `diffVersions` util + a "Changes from v(n-1)" toggle. (C) the backend `_require_role` guard generalizes from a `need_owner` bool to an allow-set, enabling the matrix edit=owner/editor · approve=owner/reviewer · comment=all; invite carries a role. App-level access only — no RLS.

**Tech Stack:** FastAPI + asyncpg + alembic + pytest (backend); React Native / Expo + Jest/RNTL (mobile).

**Spec:** `docs/superpowers/specs/2026-08-16-trust-review-loop-p0-2-design.md`

## Global Constraints

- **App-level access only — no RLS, no tenant column** (backend rule #4 / ADR-037). The role matrix lives in `_require_role` + `require_project_access`.
- **Migrations additive + backward-compatible** (new columns nullable). `asyncpg`; never block the loop. Key-redaction discipline untouched. Backend: `pytest`, 70% coverage gate.
- Mobile: `useThemedStyles`; **no color-literal test asserts**; `npx tsc --noEmit` + full `npx jest` + `npx eslint .` green. Web/native reader is the ONE renderer (no second).
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `feedback` table cols today = `id, version_id, author_kind, author_name, body, recorded_by_sub, created_at, seq`. `feedback_repo._F = "id, version_id, author_kind, author_name, body, recorded_by_sub, created_at"`. `add_feedback(conn, *, version_id, author_kind, body, recorded_by_sub, author_name=None)`; `list_feedback(conn, *, version_id)` `ORDER BY seq`. `FeedbackIn{body}`, `FeedbackOut{id,version_id,author_kind,author_name,body,created_at}`. `_require_role(conn, account, project_id, *, need_owner) -> str` (owner-only when True; owner-or-any-member when False). Gates: create_version=`need_owner=True`; approve/withdraw + get_version + add-feedback = `need_owner=False`. `access.PROJECT_ROLES=("owner","reviewer")`. `models.INVITE_ROLES=("reviewer",)`; `models.FEEDBACK_AUTHOR_KINDS=("expert","operator")`. `membership_repo.invite(conn,*,project_id,email,invited_by_sub,role="reviewer")` validates `role in INVITE_ROLES`. `InviteIn` HAS a `role: str` field; the `invite_expert` endpoint does NOT currently pass it (defaults reviewer). alembic head = `0018`. Mobile: `trustClient` `FeedbackView` (no section_index), `addFeedback(versionId, body, token)`, `getVersion`. Viewer `app/trust/version/[versionId].tsx`: `isOwner = project?.my_role === "owner"`; renders `version.content.sections` (view via `TopicRenderer inline`) + `version.feedback` in a Revision-notes block; `previewSources` memo already aggregates section source_ids.

---

## Task 1 (Slice A — backend): `feedback.section_index`

**Files:**
- Create: `backend/alembic/versions/0019_feedback_section_index.py`
- Modify: `backend/src/trust/models.py` (Feedback), `backend/src/trust/feedback_repo.py` (`_F`, add/list), `backend/src/trust/schemas.py` (FeedbackIn/Out), `backend/src/trust/router.py` (add-feedback validation)
- Test: `backend/tests/trust/test_feedback_section_index.py`

**Interfaces:**
- Produces: `Feedback.section_index: int | None`; `FeedbackIn.section_index: int | None = None`; `FeedbackOut.section_index: int | None`; `add_feedback(..., section_index=None)`.

- [ ] **Step 1: Failing test** — `backend/tests/trust/test_feedback_section_index.py` (follow the existing trust test style — a real asyncpg test DB via the project's conftest fixtures). Cover: (a) posting feedback with `section_index=1` on a version with ≥2 sections round-trips (list_feedback returns `section_index==1`); (b) `section_index=null` round-trips as None (unchanged behaviour); (c) posting `section_index` ≥ len(sections) → HTTP 422. Use the trust API test client + an existing project/artifact/version fixture (mirror `backend/tests/trust/test_feedback*.py` if present; else construct via the repos).

- [ ] **Step 2: Run — FAIL** (`section_index` unknown column / attribute).

- [ ] **Step 3: Migration** — `backend/alembic/versions/0019_feedback_section_index.py`:
```python
"""feedback.section_index — anchor a comment to one section of an (immutable) version (P0-2 slice A)"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable → existing rows stay whole-version comments; additive + backward-compatible.
    op.execute("ALTER TABLE feedback ADD COLUMN section_index integer NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE feedback DROP COLUMN section_index")
```

- [ ] **Step 4: Model + repo** — `models.py` `Feedback`: add `section_index: int | None` (after `body`; before `recorded_by_sub` is fine — dataclass field). `feedback_repo.py`: `_F = "id, version_id, author_kind, author_name, body, section_index, recorded_by_sub, created_at"`; `add_feedback` signature gains `section_index=None` and the INSERT includes the column:
```python
async def add_feedback(conn, *, version_id, author_kind, body, recorded_by_sub, author_name=None, section_index=None):
    if author_kind not in FEEDBACK_AUTHOR_KINDS:
        raise ValueError(f"invalid author_kind {author_kind!r}")
    r = await conn.fetchrow(
        f"INSERT INTO feedback (version_id, author_kind, author_name, body, section_index, recorded_by_sub) "
        f"VALUES ($1,$2,$3,$4,$5,$6) RETURNING {_F}",
        version_id, author_kind, author_name, body, section_index, recorded_by_sub,
    )
    return _feedback(r)  # or the existing row->Feedback mapper; ensure it maps section_index
```
Ensure the row→`Feedback` mapper reads `section_index`. `list_feedback` needs no change beyond `_F` already selecting the column.

- [ ] **Step 5: Schemas** — `FeedbackIn`: add `section_index: int | None = None`. `FeedbackOut`: add `section_index: int | None`. Where `FeedbackOut` is built (router `get_version`, ~line 309), pass `section_index=f.section_index`.

- [ ] **Step 6: Endpoint validation** — in the add-feedback endpoint (router ~line 469, the `role = await _require_role(..., need_owner=False)` handler): after loading the version, validate:
```python
if body.section_index is not None:
    sections = (version.content or {}).get("sections", [])
    if not (0 <= body.section_index < len(sections)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "section_index out of range")
```
Pass `section_index=body.section_index` into `feedback_repo.add_feedback(...)`. (The version content is already available in that handler or fetch it via the version repo — mirror how `get_version` loads it.)

- [ ] **Step 7: Run tests — PASS.** Then `cd backend && pytest tests/trust -q`.

- [ ] **Step 8: Commit**
```bash
git add backend/alembic/versions/0019_feedback_section_index.py backend/src/trust/{models,feedback_repo,schemas,router}.py backend/tests/trust/test_feedback_section_index.py
git commit -m "feat(trust): feedback.section_index — anchor comments to a section (P0-2 A)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 (Slice A — mobile): anchored section comments UI

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`FeedbackView`, `addFeedback`), `mobile/app/trust/version/[versionId].tsx` (per-section comment control + anchored render)
- Test: `mobile/__tests__/screens/TrustVersion.comments.test.tsx`

**Interfaces:**
- Consumes (backend, Task 1): `POST …/versions/{id}/feedback` accepts `{ body, section_index? }`; `FeedbackOut.section_index: int|null`.
- Produces: `FeedbackView.section_index: number | null`; `addFeedback(versionId, { body, section_index? }, token)`.

- [ ] **Step 1: Failing test** — `mobile/__tests__/screens/TrustVersion.comments.test.tsx`. Mock `react-native-webview` (`{default:()=>null}`) and `@/components/LessonRenderer` via `require("../../test-utils/mockTopicRenderer")` (existing helper). Stub `getVersion` to return a version with 2 sections and one `feedback` item with `section_index: 0` and one with `section_index: null`. Assert: the section-0 comment body renders in a section-0 region (near the section heading from the mock renderer); the null one renders in the "Revision notes" block; tapping "Comment" under a section, typing, and submitting calls `addFeedback` with `{ body, section_index: <that index> }` (spy the trustClient).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: trustClient** — `FeedbackView` interface: add `section_index: number | null`. Change `addFeedback` to take an object body:
```ts
export async function addFeedback(versionId: string, body: { body: string; section_index?: number | null }, token: string | null): Promise<FeedbackView> {
  return (await trustFetch<FeedbackView>(`/versions/${versionId}/feedback`, token, { method: "POST", body: JSON.stringify(body) })) as FeedbackView;
}
```
Update the existing caller in the viewer (currently `addFeedback(versionId, { body: text }, token)` — already object-shaped per the file; if it passes a bare string, wrap it).

- [ ] **Step 4: Viewer — per-section comment control + anchored render.** In `app/trust/version/[versionId].tsx` view mode, below the reader (which renders the draft as one doc), add a **per-section control list** built from `version.content.sections`: for each index `i`, a row with the section heading (small label), the comments for that section (`(version.feedback ?? []).filter(f => f.section_index === i)`), and a **"Comment" Pressable** that toggles an inline `TextInput` + submit → `addFeedback(versionId, { body: text, section_index: i }, accessToken)` then `reloadVersion()`. Keep the existing **Revision notes** block for whole-version comments, but filter it to `f.section_index == null` so anchored comments don't double-render. Use `useThemedStyles`; memoize handlers per index or use a single handler taking `i`.

- [ ] **Step 5: Run test — PASS.** Then `cd mobile && npx jest TrustVersion.comments && npx tsc --noEmit`.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/api/trustClient.ts "mobile/app/trust/version/[versionId].tsx" mobile/__tests__/screens/TrustVersion.comments.test.tsx
git commit -m "feat(trust): inline per-section comments in the draft viewer (P0-2 A)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 (Slice B): version diff

**Files:**
- Create: `mobile/src/lib/diffVersions.ts`, `mobile/__tests__/lib/diffVersions.test.ts`
- Modify: `mobile/app/trust/version/[versionId].tsx` ("Changes from v(n-1)" toggle)
- Test (viewer): `mobile/__tests__/screens/TrustVersion.diff.test.tsx`

**Interfaces:**
- Produces: `diffVersions(prev: {heading:string; body:string}[], curr: {heading:string; body:string}[]): SectionDiff[]` where `SectionDiff = { heading: string; status: "added" | "removed" | "changed" | "unchanged" }`.

- [ ] **Step 1: Failing test (pure fn)** — `mobile/__tests__/lib/diffVersions.test.ts`:
```ts
import { diffVersions } from "@/lib/diffVersions";
const S = (heading: string, body: string) => ({ heading, body });
it("classifies added / removed / changed / unchanged by heading", () => {
  const prev = [S("Intro", "a"), S("Body", "x"), S("Gone", "z")];
  const curr = [S("Intro", "a"), S("Body", "y"), S("New", "n")];
  const d = diffVersions(prev, curr);
  const by = Object.fromEntries(d.map((x) => [x.heading, x.status]));
  expect(by).toEqual({ Intro: "unchanged", Body: "changed", Gone: "removed", New: "added" });
});
it("is order-independent (reorder with same bodies = all unchanged)", () => {
  const a = [S("One", "1"), S("Two", "2")];
  const b = [S("Two", "2"), S("One", "1")];
  expect(diffVersions(a, b).every((x) => x.status === "unchanged")).toBe(true);
});
it("empty prev → all added", () => {
  expect(diffVersions([], [S("X", "x")])).toEqual([{ heading: "X", status: "added" }]);
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `mobile/src/lib/diffVersions.ts`:
```ts
export type SectionDiff = { heading: string; status: "added" | "removed" | "changed" | "unchanged" };
type Sec = { heading: string; body: string };

// Match sections by heading (order-independent). Duplicate headings match positionally
// within their same-heading group. Result lists curr's sections in order, then any removed.
export function diffVersions(prev: Sec[], curr: Sec[]): SectionDiff[] {
  const prevByHeading = new Map<string, string[]>();
  for (const s of prev) (prevByHeading.get(s.heading) ?? prevByHeading.set(s.heading, []).get(s.heading)!).push(s.body);
  const consumed = new Map<string, number>();
  const out: SectionDiff[] = [];
  for (const s of curr) {
    const bodies = prevByHeading.get(s.heading);
    const idx = consumed.get(s.heading) ?? 0;
    if (!bodies || idx >= bodies.length) out.push({ heading: s.heading, status: "added" });
    else { out.push({ heading: s.heading, status: bodies[idx] === s.body ? "unchanged" : "changed" }); consumed.set(s.heading, idx + 1); }
  }
  for (const [heading, bodies] of prevByHeading) {
    const used = consumed.get(heading) ?? 0;
    for (let i = used; i < bodies.length; i++) out.push({ heading, status: "removed" });
  }
  return out;
}
```

- [ ] **Step 4: Run test — PASS.**

- [ ] **Step 5: Viewer toggle (failing test first)** — `mobile/__tests__/screens/TrustVersion.diff.test.tsx`: stub `getVersion` so the current version has a prior version in the project's artifact `versions` list; stub the prev `getVersion` fetch to return differing sections. Assert: a "Changes from v1" control is present when a previous version exists (hidden for v1/no-prev); tapping it fetches the prev version and renders the summary (e.g. text `~ Overview`, `+ New`). Mock webview + LessonRenderer as in Task 2.

- [ ] **Step 6: Implement toggle** — in the viewer, compute the previous version id from the artifact `versions` list in `project` (the entry with `version_no === version.version_no - 1`). A collapsed-by-default "Changes from v{n-1}" `Pressable`; on first open, `getVersion(prevId, accessToken)` (memoize the fetched prev + the `useMemo` diff `diffVersions(prev.content.sections, version.content.sections)`), render each `SectionDiff` as a row (`+`/`−`/`~`/`·` glyph + heading). Hidden when no previous version.

- [ ] **Step 7: Run** — `cd mobile && npx jest diffVersions TrustVersion.diff && npx tsc --noEmit && npx eslint src/lib/diffVersions.ts`.

- [ ] **Step 8: Commit**
```bash
git add mobile/src/lib/diffVersions.ts mobile/__tests__/lib/diffVersions.test.ts "mobile/app/trust/version/[versionId].tsx" mobile/__tests__/screens/TrustVersion.diff.test.tsx
git commit -m "feat(trust): version diff — 'Changes from v(n-1)' section summary (P0-2 B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 (Slice C — backend): reviewer/editor roles

**Files:**
- Modify: `backend/src/trust/access.py` (PROJECT_ROLES), `backend/src/trust/router.py` (`_require_role` → allow-set + call sites + invite passes role), `backend/src/trust/models.py` (INVITE_ROLES)
- Test: `backend/tests/trust/test_role_matrix.py`

**Interfaces:**
- Produces: `_require_role(conn, account, project_id, *, allow: tuple[str, ...]) -> str` (raises 403 if the resolved role ∉ allow). `access.PROJECT_ROLES = ("owner","reviewer","editor")`, `models.INVITE_ROLES = ("reviewer","editor")`.

- [ ] **Step 1: Failing test** — `backend/tests/trust/test_role_matrix.py`. Seed a project (owner) + a membership for a second account as `editor` and a third as `reviewer` (via `membership_repo` or direct insert). Assert, hitting the trust API as each account:
  - **editor:** 200 on create-version (edit); **403 on approve**; 200 on add-feedback; 200 on get_version.
  - **reviewer:** **403 on create-version**; 200 on approve; 200 on add-feedback; 200 on get_version.
  - **owner:** 200 on all.
  - **invite** with `role="editor"` stores an invitation whose `role == "editor"`; `role="bogus"` → 422/400.

- [ ] **Step 2: Run — FAIL** (editor role rejected by `PROJECT_ROLES`; approve allows editor via `need_owner=False`).

- [ ] **Step 3: Role constants** — `access.py`: `PROJECT_ROLES = ("owner", "reviewer", "editor")`. `models.py`: `INVITE_ROLES = ("reviewer", "editor")`.

- [ ] **Step 4: Generalize `_require_role`** — replace the `need_owner` param with `allow`:
```python
async def _require_role(conn, account, project_id, *, allow: tuple[str, ...]) -> str:
    try:
        role = await require_project_access(conn, account_id=account.id, project_id=project_id)
    except ProjectAccessError as err:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this project") from err
    if role not in allow:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
    return role
```
Update EVERY call site (the plan's Confirmed-facts lists them):
  - **create_version** (~268): `allow=("owner", "editor")`.
  - **approve / withdraw** (~294, and the other approve path): `allow=("owner", "reviewer")`.
  - **add-feedback** (~469): `allow=("owner", "reviewer", "editor")`.
  - **get_project / get_version / listings** (~30, ~294 read paths): `allow=("owner", "reviewer", "editor")`.
  - **all currently-`need_owner=True` owner-only ops** (create_project, create_artifact, inputs add/edit/delete ~148/177/210/248, invite ~426, toc ~350/541, delete, generate ~585/725): `allow=("owner",)`.
  *(Grep `_require_role(` to find all sites; convert each explicitly — do not leave any `need_owner=`.)*

- [ ] **Step 5: Invite passes role** — in `invite_expert`, pass the request role through:
```python
inv = await membership_repo.invite(conn, project_id=project_id, email=body.email, invited_by_sub=principal.sub, role=body.role)
```
`membership_repo.invite` already validates `role in INVITE_ROLES` → a bad role raises `ValueError`; map it to a 422 in the endpoint (wrap in try/except ValueError → `HTTPException(422, ...)`), or validate `body.role in INVITE_ROLES` before the call.

- [ ] **Step 6: Run tests — PASS.** `cd backend && pytest tests/trust -q`.

- [ ] **Step 7: Commit**
```bash
git add backend/src/trust/{access,router,models}.py backend/tests/trust/test_role_matrix.py
git commit -m "feat(trust): reviewer/editor roles — _require_role allow-set + matrix + invite role (P0-2 C)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 (Slice C — mobile): role-aware controls + invite role

**Files:**
- Modify: `mobile/app/trust/version/[versionId].tsx` (canEdit/canApprove gating), the project screen's invite UI (`mobile/app/(tabs)/projects.tsx` or `mobile/app/trust/[projectId].tsx` — wherever invite lives), `mobile/src/api/trustClient.ts` (`invite` sends role)
- Test: `mobile/__tests__/screens/TrustVersion.roles.test.tsx`

**Interfaces:**
- Consumes (Task 4): edit endpoints allow owner/editor; approve allow owner/reviewer; invite accepts `role`.

- [ ] **Step 1: Failing test** — `mobile/__tests__/screens/TrustVersion.roles.test.tsx`. Stub `useTrustProject` to return `project.my_role` = `"editor"` in one render and `"reviewer"` in another. Assert: **editor** sees the Edit control and NOT Approve; **reviewer** sees Approve and NOT Edit; **owner** sees both (existing). Mock webview + LessonRenderer.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Viewer gating** — in `app/trust/version/[versionId].tsx`, derive:
```tsx
const role = project?.my_role;
const isOwner = role === "owner";
const canEdit = role === "owner" || role === "editor";
const canApprove = role === "owner" || role === "reviewer";
```
Replace the `isOwner` gate on **Edit/save** with `canEdit`, and on **Approve/withdraw** with `canApprove`. Comment/Revision-notes stay available to all. (Leave other `isOwner` uses — e.g. the operator-recorded approval-name prompt — as owner-specific unless they are the approve action.)

- [ ] **Step 4: Invite role picker** — find the invite UI (grep `invite(` / "Invite" in `app/trust/` and `(tabs)/projects.tsx`). Add a two-option control (**Reviewer** / **Editor**, default Reviewer) whose value is passed to the trustClient `invite`. Update `trustClient.invite` to send `role`:
```ts
export async function invite(projectId: string, email: string, role: "reviewer" | "editor", token: string | null): Promise<InvitationView> {
  return (await trustFetch<InvitationView>(`/projects/${projectId}/invitations`, token, { method: "POST", body: JSON.stringify({ email, role }) })) as InvitationView;
}
```
(Match the existing invite path/shape; add `role` to the body — the backend `InviteIn` already has the field.)

- [ ] **Step 5: Run** — `cd mobile && npx jest TrustVersion.roles && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 6: Commit**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/app mobile/src/api/trustClient.ts mobile/__tests__/screens/TrustVersion.roles.test.tsx
git commit -m "feat(trust): role-aware controls + invite role picker (P0-2 C)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Backend: `cd backend && pytest -q` (coverage ≥70%); `alembic upgrade head` applies 0019 cleanly on a fresh DB.
- [ ] Mobile: `cd mobile && npx tsc --noEmit && npx jest && npx eslint .`; `npx expo export -p web` succeeds.
- [ ] Manual/device (optional, via the stub-backend recipe): a version with a `section_index` comment renders anchored; the diff toggle summarizes changes; an editor account sees Edit-not-Approve. (Reuse the trust stub-backend + dev-token recipe from the whole-book render verify.)
- [ ] **Deploy:** backend migration on the prod refresh (ROOT `alembic upgrade head`), then web deploy + APK. No data backfill (all additive/nullable).

## Out of scope

Within-section text diff; comment edit/delete (append-only for now); @mentions/threading/attachments (ADR-025); carrying comments across versions; notifications; roles beyond the three.
