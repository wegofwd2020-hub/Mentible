# In-app Feedback Capture — Design

**Status:** Accepted (requirements gathered + defaults approved by the user, 2026-09-06).
**Seed:** Lovable `/pilot-feedback` prototype (marketing form) → generalized to a global, repeatable, structured-JSON feedback tool.

## 1. Goal
A signed-in user can send feedback from **any** screen in the app, **any number of times**. Each submission is **captured as a structured JSON record** (for analysis) **and** emailed to the support inbox.

## 2. Behavior
- **Global affordance**: a floating "Send feedback" button present on every **authed** screen (hidden when signed out / on public/demo/marketing routes). Opens a modal (`FeedbackSheet`).
- **Repeatable**: after a successful send the form resets (text/type/contact cleared; name/email/company/role kept) and the sheet stays open, so the user can send another immediately. No limit.
- **No user-facing Subject.** The subject is auto-composed: app name `mentible` + the page/route the feedback came from.

## 3. Fields
| Field | Source | Editable | Constraint |
|---|---|---|---|
| Name | pre-fill from login (`session.user.user_metadata.full_name`) | yes | ≤255 |
| Email | from login (server uses `Principal.email`, authoritative) | **no** (display only) | — |
| Company / project | user | yes, optional | ≤255 |
| Role | user | yes, optional | ≤255 |
| Type of feedback | dropdown | — | enum: `bug` · `feature` · `content_quality` · `pricing` · `other` |
| Feedback text | user | yes | ≤2048, required |
| Can we reach you | dropdown | — | enum: `email_follow_up` · `feedback_only` · `schedule_call` |

Auto-captured (not user-entered): `app="mentible"`, `page` (route via `usePathname()`), `created_at`.

## 4. Data model — `feedback` table (migration 0028)
Primary identifiers are **name, email, created_at** (columns); everything else is a queryable JSON payload.

```
feedback(
  id           uuid   pk default gen_random_uuid(),
  account_id   uuid   references account(id) on delete set null,  -- survive account deletion for analysis
  name         text   not null,
  email        text   not null,          -- server-set from the verified principal, NOT client-trusted
  app          text   not null default 'mentible',
  page         text   not null,
  payload      jsonb  not null,          -- { type, company, role, contact_preference, text }
  created_at   timestamptz not null default now()
)
index on (created_at desc)
```
`on delete set null` (not cascade): feedback is analysis data that must outlive a deleted account; name/email are copied into columns so the record stays complete.

## 5. Backend — `POST /api/v1/feedback`
- Auth: `require_active_user` + get_or_create_account (a first-time user has a valid JWT but maybe no row — see the known pitfall). `Depends(enforce_rate_limit)` (spam guard; fails open).
- Request (`FeedbackIn`): `name` (≤255), `company?` (≤255), `role?` (≤255), `type` (enum), `text` (1..2048), `contact_preference` (enum), `page` (≤500). **Email is NOT taken from the client** — the server uses `principal.email`.
- Handler: insert the row (payload JSONB = {type, company, role, contact_preference, text}); then **best-effort** email via ZeptoMail. Return **201**. **Storage is primary** — if the email send fails, log and still return 201 (the record is captured).
- Module `backend/src/feedback/` (repo.py, email.py, schemas + router), mounted at `/api/v1/feedback`.

### ZeptoMail email (best-effort)
- `POST https://api.zeptomail.com/v1.1/email`, header `Authorization: Zoho-enczapikey <ZEPTOMAIL_TOKEN>`.
- `from` = `ZEPTOMAIL_FROM` (default `feedback@kaundinyalabs.com` — MUST be on the verified domain), `to` = `FEEDBACK_TO` (default `support@kaundinyalabs.com`), **`reply_to` = the submitter's email**, `subject` = `[mentible] feedback — <page>`, `htmlbody` = the fields formatted.
- httpx AsyncClient, short timeout (~8s). Never raises into the request; logs on failure. Never logs the token.
- Config (`config.py`): `zeptomail_token: str|None`, `zeptomail_from: str = feedback@kaundinyalabs.com`, `feedback_to: str = support@kaundinyalabs.com`, `zeptomail_base_url: str = https://api.zeptomail.com/v1.1`.
- Compose passthrough (`docker-compose.demo.yml`, the #496 trap): pass `ZEPTOMAIL_TOKEN`, `ZEPTOMAIL_FROM`, `FEEDBACK_TO` to the **api** service (the endpoint sends inline). Values live in prod `.env.demo` (user added `ZEPTOMAIL_TOKEN`; domain verified).

## 6. Mobile / web
- **`src/api/feedbackClient.ts`**: `sendFeedback(body, token)` → `POST /api/v1/feedback`.
- **`src/components/FeedbackSheet.tsx`**: themed Modal; name (prefill, editable) · email (prefill, read-only) · company · role · type dropdown · text (2048, multiline) · contact dropdown · Send. Submit → captures `usePathname()` as `page` → `sendFeedback`. Success → `Alert`/toast "Sent — thank you", reset text/type/contact, keep sheet open. Error → `Alert`. `Alert` from `@/lib/alert`; `useThemedStyles`; dropdowns via the existing `Dropdown` component.
- **`src/components/FeedbackFab.tsx`**: a floating button, mounted once in `app/_layout.tsx` inside `AuthProvider`, rendered only when `useAuth().status === "signed_in"` (so it's absent on sign-in/public/demo). Opens the sheet. Name/email prefill from `useAuth().session.user` (`email`, `user_metadata.full_name`).
- **Help (DoD gate)**: `feature` key `send-feedback` + a topic + a tree leaf.

## 7. Deferred (fast-follow, not this build)
- Super-admin console **feedback list / export** (`/api/v1/admin/feedback`) — the JSONB store is queryable now; the admin UI comes next.
- Anonymous feedback on public/marketing pages (v1 is authed-only).

## 8. Testing
- Backend: endpoint stores a row with server email + JSON payload; email-send failure still returns 201 (best-effort); reviewer must-not-log the token; enum/length validation; rate-limit applies. ZeptoMail sender mocked (httpx MockTransport) — asserts endpoint/auth-header/from-verified/reply-to/body; NEVER hits live Zoho in CI.
- Mobile: `FeedbackSheet` submits with the current route as `page` + resets on success; `FeedbackFab` hidden when signed out, shown when signed in; feedbackClient posts correctly.
- Full `npx jest` + backend pytest + ruff before merge.
