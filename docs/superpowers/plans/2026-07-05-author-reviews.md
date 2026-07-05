# Author Reviews (feedback discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the author a Library-tab "Feedback on your drafts" section listing their shared drafts that have comments; tapping one opens the existing `ShareDraftModal`.

**Architecture:** One aggregate read endpoint (`GET /api/v1/drafts/mine`) over the existing `sharing` module (repo + router + schema), plus a mobile `DraftReviews` component that reuses `ShareDraftModal`/`loadBook`/`useFocusEffect`. No migration — additive on top of the draft-sharing feature.

**Tech Stack:** FastAPI · asyncpg · pytest; React Native + Expo · TypeScript · Jest + @testing-library/react-native.

## Global Constraints

- Endpoint `Depends(require_user)`; returns ONLY the caller's own drafts (`owner_sub == principal.sub`) — no `draft_access` needed, ownership is the filter. 503 if `app.state.db` is None. No writes → no `enforce_rate_limit`. Never log titles/bodies.
- **Route order:** `GET /mine` declared BEFORE `GET /{book_id}` (next to `/shared-with-me`), else the literal path is captured by the param route.
- Comment count is **version-scoped** to the draft's current `version` (`c.version = shared_draft.version`); only drafts with `count > 0` are returned, newest activity first.
- Mobile: reuse `draftFetch` (throws `ApiError`), `useFocusEffect` from `expo-router`, `Alert` from `@/lib/alert` (never react-native), `loadBook` from `@/storage/bookStore`, `ShareDraftModal` (props `{ visible, book, token, onClose }`), `useAuth().accessToken`. Component self-hides when signed out or empty; refetches on focus.
- Backend cmds from repo root with `PYTHONPATH=<repo root>` + `DATABASE_URL` for repo tests. A local test Postgres runs on `postgresql://postgres:postgres@localhost:5434/mentible` (migrated). Mobile from `mobile/`.

---

### Task 1: Backend — `GET /api/v1/drafts/mine`

**Files:**
- Modify: `backend/src/sharing/repo.py`, `backend/src/sharing/schemas.py`, `backend/src/sharing/router.py`
- Test: `backend/tests/test_sharing_repo.py`, `backend/tests/test_sharing_api.py`

**Interfaces:**
- Consumes: existing `sharing/repo.py` (`claim_or_share`, `upsert_draft`, `add_comment`, the `_seed` test helper) + `require_user`/`Principal` + `_pool`.
- Produces:
  ```python
  @dataclass
  class OwnedDraftReview:
      book_id: str; title: str; version: str; comment_count: int; last_comment_at: datetime | None
  async def owned_drafts_with_comments(conn, *, owner_sub: str) -> list[OwnedDraftReview]
  ```
  and `GET /api/v1/drafts/mine -> list[OwnedReviewOut]`.

- [ ] **Step 1: Write the failing repo test** (append to `backend/tests/test_sharing_repo.py`)

```python
async def test_owned_drafts_with_comments(conn):
    await _seed(conn, book_id="b1", owner="author-1")  # _seed sets version "1.0"
    await _seed(conn, book_id="b2", owner="author-1")  # shared but no comments
    await repo.add_comment(conn, book_id="b1", version="1.0", author_sub="s2", author_email="a@x.com", body="one")
    await repo.add_comment(conn, book_id="b1", version="1.0", author_sub="s3", author_email="b@x.com", body="two")
    await repo.add_comment(conn, book_id="b1", version="2.0", author_sub="s2", author_email="a@x.com", body="other-ver")
    await _seed(conn, book_id="b3", owner="other-owner")
    await repo.add_comment(conn, book_id="b3", version="1.0", author_sub="s2", author_email="a@x.com", body="x")
    mine = await repo.owned_drafts_with_comments(conn, owner_sub="author-1")
    assert [m.book_id for m in mine] == ["b1"]        # b2 has 0 comments, b3 is another owner
    assert mine[0].comment_count == 2                 # v1.0 only — the v2.0 comment is not counted
    assert mine[0].last_comment_at is not None
    assert await repo.owned_drafts_with_comments(conn, owner_sub="nobody") == []
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/mentible PYTHONPATH=$(pwd) /tmp/sddvenv/bin/pytest backend/tests/test_sharing_repo.py -q -k owned_drafts`
Expected: FAIL — `AttributeError: module … has no attribute 'owned_drafts_with_comments'`.

- [ ] **Step 3: Implement the repo function** (append to `backend/src/sharing/repo.py`)

```python
@dataclass
class OwnedDraftReview:
    book_id: str
    title: str
    version: str
    comment_count: int
    last_comment_at: datetime | None


async def owned_drafts_with_comments(conn: asyncpg.Connection, *, owner_sub: str) -> list[OwnedDraftReview]:
    """The caller's own shared drafts that have >=1 comment on their current version,
    newest activity first — the author's feedback inbox."""
    rows = await conn.fetch(
        """
        SELECT d.book_id, d.title, d.version,
               count(c.id) AS comment_count, max(c.created_at) AS last_comment_at
        FROM shared_draft d
        LEFT JOIN draft_comment c ON c.book_id = d.book_id AND c.version = d.version
        WHERE d.owner_sub = $1
        GROUP BY d.book_id, d.title, d.version
        HAVING count(c.id) > 0
        ORDER BY max(c.created_at) DESC
        """,
        owner_sub,
    )
    return [
        OwnedDraftReview(r["book_id"], r["title"], r["version"], r["comment_count"], r["last_comment_at"])
        for r in rows
    ]
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=… PYTHONPATH=$(pwd) /tmp/sddvenv/bin/pytest backend/tests/test_sharing_repo.py -q -k owned_drafts`
Expected: PASS.

- [ ] **Step 5: Write the failing API test** (append to `backend/tests/test_sharing_api.py`)

```python
@pytest.mark.asyncio
async def test_my_drafts_requires_auth():
    from httpx import ASGITransport, AsyncClient
    app.state.db = _Pool(_Conn())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/drafts/mine")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_my_drafts_ok_returns_list(as_user):
    from httpx import ASGITransport, AsyncClient
    as_user(sub="author-1", conn=_Conn())  # _Conn.fetch returns [] → empty list, 200
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/v1/drafts/mine")
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 6: Run to verify fail**

Run: `PYTHONPATH=$(pwd) /tmp/sddvenv/bin/pytest backend/tests/test_sharing_api.py -q -k my_drafts`
Expected: FAIL — route 404 (not mounted yet).

- [ ] **Step 7: Implement the schema + route**

Append to `backend/src/sharing/schemas.py`:
```python
class OwnedReviewOut(BaseModel):
    book_id: str
    title: str
    version: str
    comment_count: int
    last_comment_at: datetime | None
```

In `backend/src/sharing/router.py`: add `OwnedReviewOut` to the `from backend.src.sharing.schemas import (...)` group, and add this route **immediately next to the existing `GET /shared-with-me`** (so both literal paths precede `GET /{book_id}`):
```python
@router.get("/mine", response_model=list[OwnedReviewOut])
async def my_drafts(request: Request, p: Principal = Depends(require_user)):
    async with _pool(request).acquire() as conn:
        rows = await repo.owned_drafts_with_comments(conn, owner_sub=p.sub)
    return [OwnedReviewOut(**vars(r)) for r in rows]
```

- [ ] **Step 8: Run to verify pass + full suite + lint**

Run: `PYTHONPATH=$(pwd) /tmp/sddvenv/bin/pytest backend/tests/test_sharing_api.py -q -k my_drafts` → PASS.
Run: `DATABASE_URL=… PYTHONPATH=$(pwd) /tmp/sddvenv/bin/pytest backend/tests -q` → all green.
Run: `/tmp/sddvenv/bin/ruff check backend/src/sharing && /tmp/sddvenv/bin/ruff format --check backend/src/sharing backend/tests/test_sharing_repo.py backend/tests/test_sharing_api.py` → clean (run `ruff format` on any file it flags, then re-check).

- [ ] **Step 9: Commit**

```bash
git add backend/src/sharing/repo.py backend/src/sharing/schemas.py backend/src/sharing/router.py backend/tests/test_sharing_repo.py backend/tests/test_sharing_api.py
git commit -m "feat(sharing): GET /drafts/mine — author feedback inbox (owned drafts with comments)"
```

---

### Task 2: Mobile — `DraftReviews` section

**Files:**
- Create: `mobile/src/components/DraftReviews.tsx`, `mobile/__tests__/components/DraftReviews.test.tsx`
- Modify: `mobile/src/api/client.ts`, `mobile/app/(tabs)/library.tsx`

**Interfaces:**
- Consumes: `GET /drafts/mine` (Task 1); `draftFetch` + `ShareDraftModal` (props `{ visible: boolean; book: Book; token: string; onClose: () => void }`) + `loadBook(id) => Promise<Book | null>` from `@/storage/bookStore` + `useAuth().accessToken`.
- Produces: `export function DraftReviews(props: { token: string | null }): React.JSX.Element | null` + `export async function myDrafts(token: string): Promise<DraftReview[]>` + `export interface DraftReview`.

- [ ] **Step 1: Write the failing client test** (create `mobile/__tests__/api/myDrafts.test.ts`)

```ts
import { myDrafts } from "@/api/client";

describe("myDrafts client", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("GETs /drafts/mine with a bearer token", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ book_id: "b1", title: "T", version: "1.0", comment_count: 3, last_comment_at: null }]) } as Response),
    );
    const rows = await myDrafts("tok");
    expect(rows[0].comment_count).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/drafts\/mine$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run (from `mobile/`): `npx jest __tests__/api/myDrafts.test.ts`
Expected: FAIL — `myDrafts` not exported.

- [ ] **Step 3: Implement the client method** (append to `mobile/src/api/client.ts`, in the draft-sharing block near `sharedWithMe`)

```ts
export interface DraftReview {
  book_id: string;
  title: string;
  version: string;
  comment_count: number;
  last_comment_at: string | null;
}
export async function myDrafts(token: string): Promise<DraftReview[]> {
  return (await draftFetch(`/mine`, token)).json();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/api/myDrafts.test.ts` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 5: Write the failing component test** (create `mobile/__tests__/components/DraftReviews.test.tsx`)

```tsx
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DraftReviews } from "@/components/DraftReviews";

jest.mock("@/api/client", () => ({ myDrafts: jest.fn() }));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/components/ShareDraftModal", () => ({
  ShareDraftModal: ({ visible, book }: { visible: boolean; book: { title: string } }) => {
    const { Text } = require("react-native");
    return visible ? <Text>MODAL:{book.title}</Text> : null;
  },
}));
const mockFocus: { run: (() => void) | null } = { run: null };
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    mockFocus.run = cb;
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import * as api from "@/api/client";
import * as store from "@/storage/bookStore";
import { Alert } from "@/lib/alert";

const rows = [{ book_id: "b1", title: "My Draft", version: "1.0", comment_count: 2, last_comment_at: null }];

beforeEach(() => {
  jest.clearAllMocks();
  (api.myDrafts as jest.Mock).mockResolvedValue(rows);
});

it("renders nothing when signed out", () => {
  const { toJSON } = render(<DraftReviews token={null} />);
  expect(toJSON()).toBeNull();
});

it("renders nothing when there is no feedback", async () => {
  (api.myDrafts as jest.Mock).mockResolvedValue([]);
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalled());
  expect(screen.queryByText(/Feedback on your drafts/i)).toBeNull();
});

it("lists a draft with its comment count", async () => {
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(screen.getByText("My Draft")).toBeTruthy());
  expect(screen.getByText("2 comments")).toBeTruthy();
});

it("tapping a row with a local book opens the Share modal", async () => {
  (store.loadBook as jest.Mock).mockResolvedValue({ id: "b1", title: "My Draft" });
  render(<DraftReviews token="tok" />);
  fireEvent.press(await screen.findByLabelText("Review feedback: My Draft"));
  await waitFor(() => expect(screen.getByText("MODAL:My Draft")).toBeTruthy());
});

it("tapping a row whose book isn't on the device alerts instead of opening", async () => {
  (store.loadBook as jest.Mock).mockResolvedValue(null);
  render(<DraftReviews token="tok" />);
  fireEvent.press(await screen.findByLabelText("Review feedback: My Draft"));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(screen.queryByText(/^MODAL:/)).toBeNull();
});

it("refetches when the screen regains focus", async () => {
  render(<DraftReviews token="tok" />);
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalledTimes(1));
  await act(async () => {
    mockFocus.run?.();
  });
  await waitFor(() => expect(api.myDrafts).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 6: Run to verify fail**

Run: `npx jest __tests__/components/DraftReviews.test.tsx`
Expected: FAIL — module `@/components/DraftReviews` not found.

- [ ] **Step 7: Implement the component** (create `mobile/src/components/DraftReviews.tsx`)

```tsx
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Alert } from "@/lib/alert";
import { myDrafts, type DraftReview } from "@/api/client";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import { loadBook } from "@/storage/bookStore";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Author-side Library section: the shared drafts that have reviewer comments
// (ADR-027 D2–D4 feedback inbox). Self-hides when signed out or empty; refetches
// on screen focus. Tapping a row loads the local book and opens ShareDraftModal.
export function DraftReviews({ token }: { token: string | null }): React.JSX.Element | null {
  const [items, setItems] = useState<DraftReview[]>([]);
  const [modalBook, setModalBook] = useState<Book | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!token) {
          setItems([]);
          return;
        }
        try {
          setItems(await myDrafts(token));
        } catch {
          setItems([]);
        }
      })();
    }, [token]),
  );

  const openReview = useCallback(async (bookId: string) => {
    const book = await loadBook(bookId);
    if (!book) {
      Alert.alert("Not on this device", "Open this book from your Library to review its feedback.");
      return;
    }
    setModalBook(book);
  }, []);

  if (!token || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Feedback on your drafts</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => openReview(it.book_id)}
          accessibilityRole="button"
          accessibilityLabel={`Review feedback: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={styles.count}>
            {it.comment_count} {it.comment_count === 1 ? "comment" : "comments"}
          </Text>
        </Pressable>
      ))}
      {modalBook && token ? (
        <ShareDraftModal visible book={modalBook} token={token} onClose={() => setModalBook(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  count: { fontSize: typography.sizeXs, color: colors.growth, fontWeight: "700" },
});
```

- [ ] **Step 8: Run to verify pass**

Run: `npx jest __tests__/components/DraftReviews.test.tsx` → PASS (6). `npm run typecheck` → clean.

- [ ] **Step 9: Mount in the Library tab**

In `mobile/app/(tabs)/library.tsx`: add `import { DraftReviews } from "@/components/DraftReviews";`. Everywhere `<SharedWithYou token={accessToken} />` is rendered (both return branches — the empty-library branch and the FlatList header), render `<DraftReviews token={accessToken} />` directly beside it (author feedback above or below the recipient's "Shared with you" — either order; keep them adjacent).

- [ ] **Step 10: Run to verify pass + full suite + lint + typecheck**

Run: `npx jest __tests__/components/DraftReviews.test.tsx __tests__/api/myDrafts.test.ts` → PASS.
Run: `npx jest` → full suite green. `npm run typecheck` → clean. `npx eslint src/components/DraftReviews.tsx app/\(tabs\)/library.tsx src/api/client.ts` → no new errors.

- [ ] **Step 11: Commit**

```bash
git add mobile/src/components/DraftReviews.tsx mobile/__tests__/components/DraftReviews.test.tsx mobile/__tests__/api/myDrafts.test.ts mobile/src/api/client.ts mobile/app/\(tabs\)/library.tsx
git commit -m "feat(sharing): author 'Feedback on your drafts' Library section"
```

---

## Self-Review

**Spec coverage:**
- `GET /drafts/mine` + `owned_drafts_with_comments` (owner-only, version-scoped, count>0, newest first) → Task 1. ✔
- Route ordering before `/{book_id}` → Task 1 Step 7 (placed next to `/shared-with-me`). ✔
- 401 without auth, only caller's drafts → Task 1 tests. ✔
- `myDrafts` client + `DraftReview` type → Task 2. ✔
- `DraftReviews` section: self-hide signed-out/empty, count badge, tap → `loadBook` → `ShareDraftModal`, `loadBook` null → Alert, refetch-on-focus → Task 2 component + 6 tests. ✔
- Mount in both `library.tsx` branches via `useAuth().accessToken` → Task 2 Step 9. ✔
- No migration; ships with the same backend deploy → no migration task (correct). ✔

**Placeholder scan:** none — every code step is complete; the mount step (Step 9) points at the concrete `SharedWithYou` call sites rather than inventing structure (implementer matches the real file), acceptable and verified by typecheck/lint.

**Type consistency:** `OwnedDraftReview`(repo) ↔ `OwnedReviewOut`(schema) ↔ `DraftReview`(client) share field names (`book_id/title/version/comment_count/last_comment_at`); `datetime`→`str | null` on the client for `last_comment_at`; `ShareDraftModal` props `{visible, book, token, onClose}` match Task 2 usage; `loadBook(id) => Book | null` used consistently.
