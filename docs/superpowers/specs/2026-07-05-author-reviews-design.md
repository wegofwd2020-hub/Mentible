# Author Reviews (feedback discovery) — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Extends:** the draft-sharing feature (ADR-027 D2–D4) — spec `2026-07-05-draft-sharing-design.md`. This is a discovery surface on top of it; no ADR change.
**Branch:** stacks on `feat/draft-sharing` (PR #267).

## Summary

Give the **author** a single place to see which of their shared drafts have received
**reviewer comments**, so they don't have to reopen every book's Share modal to find
feedback. A **"Feedback on your drafts"** section on the Library tab lists the author's
own shared drafts that have ≥1 comment (version-scoped), newest activity first; tapping
a row opens the existing **`ShareDraftModal`** for that book (where they read the thread
and respond).

## Scope

**In scope**
- Backend: an aggregate endpoint returning the signed-in author's owned shared drafts that
  have comments, with a per-draft comment count + last-comment timestamp.
- Mobile: an author-side Library section listing them; tap → the existing `ShareDraftModal`.

**Out of scope (unchanged / deferred)**
- No notification / push / unread-badge system — this is a pull surface (refetch on focus).
- No new comment/response mechanics — reading + responding stays in `ShareDraftModal`.
- Drafts shared but with **zero** comments do not appear here (reached via the book's Share
  button). Showing all shared drafts is a possible later "My shared drafts" view, not this.
- No cross-device fetch of the book for the modal — if the book isn't on this device,
  tapping shows a friendly message (see Edge cases).

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | Tap a review row → the **existing `ShareDraftModal`** (invites + comments + responses), not a separate focused thread. |
| 2 | The list shows only the author's drafts **with ≥1 comment** (feedback inbox), version-scoped to the draft's current version. |
| 3 | Lives as a **Library-tab section** ("Feedback on your drafts"), parallel to the recipient's "Shared with you"; self-hides when signed out or empty; **refetches on screen focus**. |
| 4 | Opening the modal needs the book **on this device** (`loadBook`); if absent, a friendly Alert — no cross-device book fetch in this cut. |

## Backend

New repo function + endpoint in the existing `backend/src/sharing/` module.

### Repo (`backend/src/sharing/repo.py`, append)
```python
@dataclass
class OwnedDraftReview:
    book_id: str
    title: str
    version: str
    comment_count: int
    last_comment_at: datetime | None

async def owned_drafts_with_comments(conn, *, owner_sub: str) -> list[OwnedDraftReview]:
    # shared_draft (owner = owner_sub) LEFT JOIN draft_comment on
    # (book_id, version = shared_draft.version); GROUP BY; HAVING count > 0;
    # ORDER BY max(created_at) DESC.
```
SQL:
```sql
SELECT d.book_id, d.title, d.version,
       count(c.id) AS comment_count, max(c.created_at) AS last_comment_at
FROM shared_draft d
LEFT JOIN draft_comment c ON c.book_id = d.book_id AND c.version = d.version
WHERE d.owner_sub = $1
GROUP BY d.book_id, d.title, d.version
HAVING count(c.id) > 0
ORDER BY max(c.created_at) DESC
```
Version-scoped count matches what `ShareDraftModal` shows (current version only). Comment
count includes any comment on that version (reviewers' + the author's own) — it is a
"feedback exists" signal, not an unread count.

### Endpoint (`backend/src/sharing/router.py`, add)
- `GET /api/v1/drafts/mine` — `Depends(require_user)`. Returns
  `list[OwnedReviewOut]` (`book_id, title, version, comment_count, last_comment_at`) via
  `owned_drafts_with_comments(conn, owner_sub=principal.sub)`. Only the caller's own drafts
  (owner_sub = `principal.sub`) — no cross-user access, no `draft_access` needed (ownership
  is the filter). 503 if `app.state.db` is None (mirrors the other routes).
- **Route order:** declare `GET /mine` **before** `GET /{book_id}` (same rule as
  `/shared-with-me`), so the literal path isn't captured by the param route. Place it next
  to `shared-with-me`.

No writes → no `enforce_rate_limit`. No logging of titles/bodies.

## Mobile

### API client (`mobile/src/api/client.ts`, append)
```ts
export interface DraftReview {
  book_id: string; title: string; version: string;
  comment_count: number; last_comment_at: string | null;
}
export async function myDrafts(token: string): Promise<DraftReview[]>; // GET /drafts/mine
```
Reuses the existing `draftFetch` helper (throws `ApiError` on non-2xx).

### Component (`mobile/src/components/DraftReviews.tsx`, new)
`{ token: string | null }` → `React.JSX.Element | null`.
- Fetches `myDrafts(token)` in a `useFocusEffect` (mirrors `SharedWithYou`) — refetches when
  the Library screen regains focus; resets to `[]` and skips the call when `token` is null.
- Returns `null` when `token` is null **or** the list is empty (no header in either case).
- Header: **"Feedback on your drafts"**. Each row (accessibilityLabel
  `Review feedback: {title}`): title + `{comment_count} comment(s)` badge.
- On tap: `loadBook(book_id)` (from `@/storage/bookStore`); if a `Book` is returned, open
  `ShareDraftModal` with `{ book, token, visible, onClose }`; if `null`, show a 1-button
  `Alert` (from `@/lib/alert`) "This book isn't on this device — open it from your Library
  to review." Only one modal at a time (track the open book in state).

### Mount (`mobile/app/(tabs)/library.tsx`)
Render `<DraftReviews token={accessToken} />` alongside `<SharedWithYou token={accessToken} />`
in the Library header area, in **both** return branches (empty-library and FlatList),
matching how `SharedWithYou` was mounted. `accessToken` from the existing `useAuth()`.

## Error handling & edge cases

- **Signed out / empty** → the section renders nothing (null).
- **`loadBook` returns null** (book not on this device) → friendly 1-button Alert; the modal
  does not open. (Backend has the `book_json`, but `ShareDraftModal` re-shares the local book
  on open, so a local book is required in this cut.)
- **Fetch failure** → degrade to an empty list (no crash), same as `SharedWithYou`.
- **Stale count** — refetch is on focus, not live; a comment added while the author sits on
  the Library tab appears when they navigate away and back (acceptable; consistent with
  `SharedWithYou`).
- **Version bump** — if the author re-shared a newer version, the count reflects the current
  version's comments only (older-version comments are not counted), matching D4 + the modal.

## Testing

Backend (`backend/tests/test_sharing_repo.py` + `test_sharing_api.py`):
- Repo: an owned draft with 2 comments on its current version → `comment_count == 2`,
  `last_comment_at` = the latest; a draft with 0 comments is **excluded**; a comment on a
  *different* version is **not** counted; another owner's draft is not returned.
- API: `GET /drafts/mine` 401 without a token; returns only the caller's drafts; shape
  matches `OwnedReviewOut`.

Mobile (`mobile/__tests__/components/DraftReviews.test.tsx`):
- Renders null when signed out and when `myDrafts` returns empty.
- Lists a draft with its comment count.
- Tapping a row with a local book opens `ShareDraftModal` (assert via a mocked
  `loadBook` + a mocked/inspected `ShareDraftModal`); tapping when `loadBook` returns null
  fires the Alert and does not open the modal.
- Refetches on focus (mock `useFocusEffect`, re-fire → `myDrafts` called again), mirroring
  the `SharedWithYou` focus test.

## Files

**Backend**
- Modify: `backend/src/sharing/repo.py` (`OwnedDraftReview` + `owned_drafts_with_comments`)
- Modify: `backend/src/sharing/schemas.py` (`OwnedReviewOut`)
- Modify: `backend/src/sharing/router.py` (`GET /mine`, ordered before `/{book_id}`)
- Modify: `backend/tests/test_sharing_repo.py`, `backend/tests/test_sharing_api.py`

**Mobile**
- Create: `mobile/src/components/DraftReviews.tsx`, `mobile/__tests__/components/DraftReviews.test.tsx`
- Modify: `mobile/src/api/client.ts` (`DraftReview` + `myDrafts`)
- Modify: `mobile/app/(tabs)/library.tsx` (mount `DraftReviews` in both branches)

## Phasing (for the plan)
1. Backend: repo `owned_drafts_with_comments` + `OwnedReviewOut` + `GET /drafts/mine` + tests.
2. Mobile: `myDrafts` client + `DraftReviews` component + mount in `library.tsx` + tests.

## Rollout
- Additive: one new read endpoint, no migration. Still needs the prod backend redeploy that
  the draft-sharing feature already requires (`alembic upgrade head` already covers the
  tables; `/drafts/mine` ships with the same backend deploy). Fails closed (empty section)
  until deployed.
