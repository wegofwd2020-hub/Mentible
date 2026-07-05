# Draft Sharing (ADR-027 D2–D4) — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Implements:** ADR-027 sub-project 1 (draft sharing). ADR-027 stays the governing decision record; this spec is the build spec for its D2–D4.

## Summary

Let a **registered author** share a work-in-progress **draft** of a book with specific
people **by email**, and get their feedback back as **comments** — the author →
reviewer loop the current file-handoff can't do. The draft's `book.json` is **hosted
server-side** so the author can see recipients' comments. Recipients access it **in-app**:
when a person signs in with an email that was invited, the draft appears in a **"Shared
with you"** list; they read it and comment. Comments are a **single flat thread per
draft version** (ADR-027 D4).

This is the MVP. It deliberately hosts author content on our servers (ADR-027 D8) —
**private, invite-only** drafts only; a user's private *unshared* library stays
device-local.

## Scope

**In scope**
- Author: share/re-share a draft, invite recipients by email, revoke an invite, view the
  comment thread and reply.
- Recipient (registered, invited email): see "Shared with you," read the draft, comment.
- Backend hosted draft store + invitations + version-scoped comments + authz.

**Out of scope (deferred — flagged in ADR-027)**
- **Guest / non-registered access (O5):** recipients must be registered and sign in with
  the invited email. No guest sessions, no magic links.
- **Transactional email:** no "you've been invited" email is sent (no email infra). The
  author tells the recipient out-of-band; discovery is the "Shared with you" list.
- **Comment threading / resolve-close (O2 richer variants):** flat thread only.
- **Paid gate (O1):** any registered author may share.
- **Draft moderation reach (O3), retention windows:** content is kept until the author
  unshares (revokes all) or deletes; ADR-020 moderation of private drafts is deferred.
- **Open Library / RELEASE publishing (D5–D7):** a separate ADR-027 sub-project.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | **Invite delivery = in-app "Shared with you," registered-only.** The invitation (by email) is the access grant; the recipient must sign in with a verified email that matches an active invitation. No email sent, no guest path (O5 deferred). |
| 2 | **Comments = one flat thread per draft version.** Author + all active invitees see every comment; author "replies" by adding a comment. No nesting, no resolve/close (O2). |
| 3 | **Any registered author may share** — no subscriber gate (O1). |
| 4 | **Author can revoke** an invitation (recipient loses access); content retained until unshared/deleted (O3). |
| 5 | **Version-scoped comments** (ADR-027 D4): a comment attaches to the draft's `version` string; re-sharing a new version does not carry comments forward. |
| 6 | **Optional author response per comment.** Each comment carries an optional `author_response` that **only the draft owner** may set/edit/clear — one inline answer per comment, rendered under it as "Author: …". Reviewers cannot fill it. |

## Architecture

Follows the existing **hosted-content pattern** (`backend/src/library/published_repo.py`
+ `published_artifact` table + `claim_or_check_owner`). New, isolated `backend/src/sharing/`
module (repo + router + schemas), one alembic migration, mirroring `accounts`/`library`.

Identity: `Principal` (`backend/src/auth/principal.py`) already carries `sub` (stable id)
and `email` (from the verified JWT `email` claim). Authz matches a recipient's
**verified** `principal.email` (lowercased) to an active invitation — the IdP (Supabase)
verifies email ownership, so an invitation to `alice@x.com` only admits someone who
signed in as that verified address.

## Data model (one alembic migration `0008_draft_sharing.py`)

```
shared_draft
  book_id      text  PRIMARY KEY          -- == the app's book id
  owner_sub    text  NOT NULL             -- first-share-wins owner (Principal.sub)
  version      text  NOT NULL             -- ADR-008 book version string, e.g. "1.0"
  title        text  NOT NULL
  book_json    jsonb NOT NULL             -- the shared draft content
  created_at   timestamptz NOT NULL default now()
  updated_at   timestamptz NOT NULL default now()

draft_invitation
  id            bigserial PRIMARY KEY
  book_id       text NOT NULL references shared_draft(book_id) on delete cascade
  invited_email text NOT NULL             -- stored lowercased
  invited_by_sub text NOT NULL
  created_at    timestamptz NOT NULL default now()
  revoked_at    timestamptz NULL          -- NULL = active
  UNIQUE (book_id, invited_email)

draft_comment
  id              bigserial PRIMARY KEY
  book_id         text NOT NULL references shared_draft(book_id) on delete cascade
  version         text NOT NULL           -- the draft version the comment is on
  author_sub      text NOT NULL           -- the commenter (reviewer or draft owner)
  author_email    text NULL               -- display only
  body            text NOT NULL
  author_response text NULL               -- optional; set ONLY by the draft owner (D6)
  responded_at    timestamptz NULL        -- when author_response was last set
  created_at      timestamptz NOT NULL default now()
  index (book_id, version, created_at)
```

Ownership: `claim_or_share(conn, book_id, sub)` — INSERT-or-check like
`claim_or_check_owner`; only the owner may re-share / invite / revoke.

## Backend API (new `backend/src/sharing/router.py`, `app.include_router` in `backend/main.py`)

All endpoints `Depends(require_user)`. Prefix `/api/v1/drafts`.

Authz helper (`sharing/repo.py`):
`async def draft_access(conn, book_id, principal) -> "owner" | "invited" | None` —
`owner` if `shared_draft.owner_sub == principal.sub`; else `invited` if an active
(`revoked_at IS NULL`) `draft_invitation` row has `invited_email == lower(principal.email)`
and `principal.email` is present; else `None`.

| Method + path | Who | Behavior |
|---|---|---|
| `POST /drafts/{book_id}/share` | author | Body = `{ title, version, book_json }`. `claim_or_share` (first caller owns; a different `sub` → 403). Upsert `title/version/book_json/updated_at`. Returns the stored draft meta. |
| `GET /drafts/{book_id}/invitations` | owner | List invitations (`email`, `created_at`, `revoked_at`). 403 if not owner. |
| `POST /drafts/{book_id}/invitations` | owner | Body `{ email }`. Lowercase + basic email shape check (else 422). Upsert active invitation (re-inviting a revoked email reactivates: `revoked_at = NULL`). |
| `DELETE /drafts/{book_id}/invitations` | owner | Body/query `{ email }`. Set `revoked_at = now()`. 404 if no such invite. |
| `GET /drafts/shared-with-me` | recipient | Drafts with an active invitation matching `principal.email`. Returns `[{ book_id, title, owner_sub, version, updated_at }]`. Empty if `principal.email` is null. |
| `GET /drafts/{book_id}` | owner or invited | `draft_access` must be non-null (else 403/404). Returns `{ book_id, title, version, book_json, access: "owner"｜"invited" }`. |
| `GET /drafts/{book_id}/comments?version=` | owner or invited | Comments for `(book_id, version)`, oldest-first. |
| `POST /drafts/{book_id}/comments` | owner or invited | Body `{ version, body }`. `draft_access` non-null. Insert with `author_sub`/`author_email`. Returns the comment (incl. `author_response: null`). Empty/whitespace body → 422. |
| `PUT /drafts/{book_id}/comments/{comment_id}/response` | **owner only** | Body `{ response }`. `draft_access` must be `owner` (else 403). Sets `author_response` + `responded_at`; an empty/whitespace `response` **clears** it (both → NULL). 404 if the comment isn't on this draft. Returns the updated comment. |

Rate limiting: reuse `enforce_rate_limit` (as `library.router.publish_book` does) on the
write endpoints (`share`, `invitations` POST, `comments` POST).

Errors: 401 (no token — `require_user`), 403 (wrong owner / no access), 404 (unknown
draft/invite), 422 (bad email / empty body). No content in logs beyond ids
(`structlog`; never log `book_json`/comment bodies at info).

## Mobile

### API client (`mobile/src/api/client.ts` — extend, following `publishBook`)
`shareDraft(book, token)`, `listInvitations/addInvitation/revokeInvitation(bookId, email, token)`,
`sharedWithMe(token)`, `getSharedDraft(bookId, token)`, `listComments(bookId, version, token)`,
`postComment(bookId, version, body, token)`, `setCommentResponse(bookId, commentId, response, token)`
(owner-only author response). All use `BASE_URL/api/v1/drafts…` +
`Authorization: Bearer ${token}` (Supabase session token, per existing pattern).

### Author — Share surface
Entry point: a **Share** action on the saved-book screen (`mobile/app/book/saved/[id].tsx`,
next to the existing Publish section) — the single MVP entry (a shelf-sidebar shortcut is
a possible fast-follow, not in this spec). A `ShareDraftModal`:
- On open: `shareDraft` (upsert current book.json + its `metadata.version`), then
  `listInvitations`.
- Add recipient: email input → `addInvitation`. List recipients with a revoke (🗑 →
  `revokeInvitation`).
- **Comments** section (the shared `DraftCommentThread`): `listComments(book, version)`; a
  text field + Send → `postComment`. Shows author/reviewer names (email) + timestamps.
  Each comment renders its optional `author_response` beneath it ("Author: …"); because
  the viewer here is the owner, each comment also shows an **"Add / edit response"**
  affordance → a small inline input → `setCommentResponse` (empty clears it).

Requires the author to be signed in (gate the Share action on `useAuth`).

### Recipient — "Shared with you"
A section on the **Library** tab (only shown when signed in AND `sharedWithMe` is
non-empty): a compact list of shared drafts (title + owner). Tapping one:
- `getSharedDraft` → render a **read view** of the returned `book_json` reusing the
  existing reader (`book/read` path / `LessonRenderer`), plus the same flat **comment
  thread** (list + add). The shared `DraftCommentThread` takes an `isOwner` prop; here
  `isOwner=false`, so author responses render **read-only** and there's no response
  affordance.

No shelf/EPUB storage — shared drafts are fetched live, not saved to the local library.

## Error handling & edge cases

- Recipient with **no email claim** → `sharedWithMe` empty, `draft_access` denies. (Rare;
  Supabase email/Google sign-ins carry `email`.)
- **Re-share a new version:** upserts `shared_draft.version` + `book_json`; existing
  comments (older version) stay attached to their version and are not shown for the new
  version (D4). The comment view filters by the draft's current `version`.
- **Revoke then re-invite:** reactivates the same invitation row (`revoked_at = NULL`).
- **Owner deletes/unshares:** deleting the `shared_draft` cascades invitations + comments.
  (An explicit "stop sharing"/delete endpoint can be a fast-follow; MVP relies on revoking
  all invitations to cut access.)
- Offline / backend down: the client surfaces a friendly error (like `handleImport`),
  never crashes; "Shared with you" simply shows nothing.

## Testing

Backend (`pytest`, existing DB-test harness + `require_user` override):
- `draft_access`: owner / invited(active) / invited(revoked) / not-invited / no-email.
- share ownership (first-share-wins; second `sub` → 403); re-share upsert.
- invitations add/list/revoke/reactivate; unique per email.
- `shared-with-me` matches active invitations by email, excludes revoked.
- comments: version-scoped list; post requires access; empty body → 422; a new version
  doesn't surface old-version comments.
- author response: owner sets/edits/clears (empty → NULL) and it's returned in the list;
  an **invited (non-owner) caller is 403**; response on an unknown/other-draft comment → 404.
- **No comment body / book_json in any log line** (extends the mandatory no-key-in-logs
  discipline).

Mobile (`jest` + RNTL, mocked client):
- `ShareDraftModal`: add/revoke invitation calls; posts a comment; lists comments.
- `DraftCommentThread`: renders an author response beneath a comment; `isOwner` shows the
  add/edit-response affordance, `isOwner=false` does not.
- "Shared with you" section: hidden when empty/signed-out; renders shared drafts.

## Files

**Backend (new)**
- `backend/alembic/versions/0008_draft_sharing.py`
- `backend/src/sharing/__init__.py`, `repo.py`, `router.py`, `schemas.py`
- `backend/tests/test_sharing.py`
**Backend (modified)**
- `backend/main.py` — `app.include_router(sharing_router.router)`

**Mobile (new)**
- `mobile/src/components/ShareDraftModal.tsx`
- `mobile/src/components/SharedWithYou.tsx` (Library-tab section)
- `mobile/src/components/DraftCommentThread.tsx` (shared by author + recipient)
- Matching tests under `mobile/__tests__/`.
**Mobile (modified)**
- `mobile/src/api/client.ts` — the new draft endpoints.
- `mobile/app/book/saved/[id].tsx` — Share action.
- `mobile/app/(tabs)/library.tsx` — mount `SharedWithYou`.

## Phasing (drives the implementation plan)

1. **Backend store + authz:** migration + `shared_draft` + `claim_or_share` + `draft_access`
   + `POST /share` + `GET /drafts/{id}`. Tests.
2. **Backend invitations + shared-with-me:** invitations add/list/revoke + `GET /shared-with-me`. Tests.
3. **Backend comments:** version-scoped list/post + owner-only author-response (`PUT …/response`). Tests. Wire `include_router`.
4. **Mobile author:** client methods + `ShareDraftModal` + `DraftCommentThread` + Share action.
5. **Mobile recipient:** `SharedWithYou` + read view + comments.

## Rollout / ops

- New DB migration (`alembic upgrade head`) + backend redeploy required on prod
  (`/opt/mentible` manual swap — the backend is not auto-deployed). CI runs the migration
  + tests. **Nothing goes live until the backend is redeployed.**
- ADR-027 D8 footprint: private invite-only author content now lives server-side + is
  readable by us/moderation. Acceptable for the MVP per the build decision; public
  Open-Library gates (ADR-021 D8) are a separate sub-project's concern.
