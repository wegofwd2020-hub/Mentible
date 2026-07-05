# Draft-sharing UX polish — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Extends:** the draft-sharing feature (ADR-027 D2–D4) — already merged (`main@70857ec`). Two UX refinements from on-device testing. Mobile-only; **no backend change** (endpoints already exist).

## Summary

Two fixes to how sharing feedback is read and surfaced:

1. **Full-screen recipient reader.** Today a recipient taps a draft in the Library's
   "Shared with you" list and it expands into a cramped inline panel — too small to read.
   Replace that with a **full-screen read-only reader** using the same components as the
   Studio book screen (contents list → full-width topic content), with the comment thread
   at the bottom.
2. **Comment badge in Studio, drop the Library list.** Today the author's feedback lives in
   a "Feedback on your drafts" section at the top of the Library. Move it **onto the book
   it's about**: a **💬 count badge** on each authored-book row in the **Studio (Books)**
   tab; tapping it opens that book's `ShareDraftModal`. Remove the Library section.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | Recipient reading opens a **full-screen route** (`/book/shared/{id}`), read-only, reusing `TopicReadList` + `TopicRenderer` — same look as the Studio book screen. Comment thread at the bottom. |
| 2 | The `SharedWithYou` section becomes a **plain list** that navigates to the reader (no inline expansion). |
| 3 | Author feedback = a **💬 comment-count badge** on authored-book rows in the **Studio (Books)** tab; tap → that book's `ShareDraftModal`. |
| 4 | **Remove** the `DraftReviews` "Feedback on your drafts" section from the Library tab (delete the component + both mounts). The `/drafts/mine` endpoint + `myDrafts` client stay — now consumed by Studio. |

## Scope

**In scope (mobile only):** a new read-only reader route; the `SharedWithYou` nav change; a
comment badge + modal wiring on the Studio Books list; removal of the Library `DraftReviews`
section.

**Out of scope:** backend (unchanged — `/drafts/mine`, `getSharedDraft`, comments already
exist); the reader *ratings* feature (`book/reviews/[id]`, ADR-023 — unrelated); the recipient
being able to set author responses (still owner-only).

## #1 — Full-screen recipient reader

### New route `mobile/app/book/shared/[id].tsx`
Read-only. Mirrors the reading half of `mobile/app/book/saved/[id].tsx` but sourced from the
**fetched** draft (not local storage), and with no authoring controls.

- Params: `id` (book_id). Auth token via `useAuth().accessToken`; if no token, show a
  "Sign in to read shared drafts" message (this route is only reached when signed in).
- On mount: `getSharedDraft(id, token)` → `{ book_json, title, version }`. Keep the `Book`
  (`book_json as Book`) + `version` in state; load `listComments(id, version, token)`.
- Layout (full-screen, inside the app's `PageContainer`):
  - **Contents view** (no topic selected): the book title + `TopicReadList book={book}
    onOpen={setTopicId}` + the **comment thread** (`DraftCommentThread comments={comments}
    isOwner={false} onPost=…`) below the contents.
  - **Topic view** (a topic selected): a "← Contents" back control + full-width
    `TopicRenderer topic={book.content[topicId]}`. (Reading is the whole screen; return to
    contents to comment.)
- `onPost` → `postComment(id, version, body, token)` then reload comments; failures surface
  a small inline error (don't crash), matching the existing sharing components.
- Errors: fetch failure → a "Couldn't load this draft" message with a back affordance.

### `mobile/src/components/SharedWithYou.tsx` (simplify)
- Remove the inline read view + its state (`open`, `draftBook`, `topicId`, `comments`,
  `openDraft`, `TopicReadList`/`TopicRenderer`/`DraftCommentThread` imports).
- Each row's `onPress` → `useRouter().push(\`/book/shared/${item.book_id}\`)`.
- Keep: `sharedWithMe` fetch on focus, self-hide when signed out/empty, the row list.

## #2 — Comment badge in Studio + remove Library list

### `mobile/app/(tabs)/books.tsx` (Studio)
`BooksScreenInner` already loads authored books (`loadBookIndex` → `BookMeta[]`) and
`openBook(id) → /book/saved/${id}`.
- Add `const { accessToken } = useAuth();` and, in a `useFocusEffect`, fetch
  `myDrafts(accessToken)` when signed in → build a `Map<book_id, comment_count>` in state
  (empty/skip when signed out or on failure — degrade silently).
- On each book row whose id is in the map with `comment_count > 0`, render a **💬 badge**
  showing the count (accessibilityLabel `Feedback: {n} comments`). The badge is a `Pressable`
  that **stops propagation** of the row press (so tapping the badge ≠ opening the book).
- Tap the badge → `loadBook(id)` → open `ShareDraftModal` `{ visible, book, token, onClose }`
  (one modal at a time via a `modalBook` state); if `loadBook` is null → an `Alert` (from
  `@/lib/alert`) "This book isn't on this device."
- Refetch the map on focus so newly-arrived comments update the badge.

### `mobile/app/(tabs)/library.tsx` (remove the section)
- Delete both `<DraftReviews token={accessToken} />` mounts (empty-library + FlatList header
  branches) and the import. Leave `SharedWithYou` as-is (per #1 it stays, just navigates).

### Delete
- `mobile/src/components/DraftReviews.tsx` + `mobile/__tests__/components/DraftReviews.test.tsx`
  (superseded by the Studio badge). Keep `myDrafts` + `DraftReview` in `client.ts`.

## Files

**Create**
- `mobile/app/book/shared/[id].tsx` + `mobile/__tests__/app/book-shared.test.tsx`

**Modify**
- `mobile/src/components/SharedWithYou.tsx` (+ its test — drop the read-view cases, assert
  the row now navigates)
- `mobile/app/(tabs)/books.tsx` (+ its test, or a focused new test for the badge)
- `mobile/app/(tabs)/library.tsx` (remove `DraftReviews`)

**Delete**
- `mobile/src/components/DraftReviews.tsx`, `mobile/__tests__/components/DraftReviews.test.tsx`

## Testing

- **Shared reader route** (`book-shared.test.tsx`): mock `getSharedDraft`/`listComments`/
  `postComment` + the reader components; asserts contents render from the fetched book,
  tapping a topic shows its content, back returns to contents, and posting calls `postComment`.
  A fetch rejection shows the error message (no crash).
- **SharedWithYou**: signed-out/empty → null; a row press calls `router.push('/book/shared/{id}')`
  (mock `useRouter`). (Remove the old inline read-view assertions.)
- **Studio badge** (`books.tsx`): with `myDrafts` returning `{book_id, comment_count}`, a badge
  with the count renders on that row; pressing the badge opens `ShareDraftModal` (mocked) and
  does **not** trigger the row's open-book navigation; a book absent from the map shows no
  badge; signed-out shows no badges.
- **Library**: `DraftReviews` no longer rendered (its text/section absent).
- Full mobile suite + `tsc` + lint green.

## Phasing (for the plan)
1. **#1** — new `book/shared/[id]` reader route + simplify `SharedWithYou` to navigate.
2. **#2** — Studio comment badge (+ modal) + remove the Library `DraftReviews` section + delete the component.

## Rollout
- Mobile-only; no backend/migration. Ships in the next web deploy + the next APK (vc7) —
  supersedes vc6 (which has the sharing feature but the old inline reader + Library list).
