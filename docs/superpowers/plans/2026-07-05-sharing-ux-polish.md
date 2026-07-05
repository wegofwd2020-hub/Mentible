# Draft-sharing UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recipients read shared drafts full-screen (not a cramped inline panel), and authors see feedback as a 💬 badge on the book in Studio (not a top-of-Library list).

**Architecture:** Mobile-only, no backend change. Task 1 adds a full-screen read-only route `book/shared/[id]` (reusing `TopicReadList`/`TopicRenderer`/`DraftCommentThread`) and turns `SharedWithYou` into a plain list that navigates to it. Task 2 adds a comment-count badge to the Studio (Books) rows wired to `myDrafts`/`ShareDraftModal`, and removes the Library `DraftReviews` section.

**Tech Stack:** React Native + Expo · expo-router · TypeScript · Jest + @testing-library/react-native.

## Global Constraints

- **No backend change** — `getSharedDraft`, `listComments`, `postComment`, `myDrafts`, and the `/api/v1/drafts/*` routes already exist. Reuse `TopicReadList` (`@/components/TopicReadList`, props `{ book: Book; onOpen: (topicId: string) => void }`), `TopicRenderer` (`@/components/LessonRenderer`, props `{ topic: GeneratedTopic }`), `DraftCommentThread` (`@/components/DraftCommentThread`, props `{ comments, isOwner, onPost, onRespond? }`), `ShareDraftModal` (`@/components/ShareDraftModal`, props `{ visible, book, token, onClose }`), `loadBook` (`@/storage/bookStore`, `(id) => Promise<Book | null>`), `useAuth` (`@/auth/AuthProvider`, `.accessToken: string | null`), `Alert` (`@/lib/alert`, never react-native), `PageContainer` (`@/components/PageContainer`).
- `getSharedDraft(id, token)` returns `{ book_json: unknown; title: string; version: string; access: string }`; cast `book_json as Book`.
- Theme tokens (`colors.*`, `spacing.*`, `radius.*`, `typography.size*`) exist — use them; no hardcoded colors.
- Mobile cmds from `mobile/`. Tests `npx jest <path>`; typecheck `npm run typecheck`; lint `npx eslint <files>`. Full suite `npx jest` at the end of each task.

---

### Task 1: Full-screen recipient reader

**Files:**
- Create: `mobile/app/book/shared/[id].tsx`, `mobile/__tests__/app/book-shared.test.tsx`
- Modify: `mobile/src/components/SharedWithYou.tsx`, `mobile/__tests__/components/SharedWithYou.test.tsx`

**Interfaces:**
- Consumes: `getSharedDraft`, `listComments`, `postComment`, `DraftComment` (`@/api/client`); `TopicReadList`, `TopicRenderer`, `DraftCommentThread`; `useAuth`; `PageContainer`.
- Produces: a route at `/book/shared/{id}` (recipient reader). `SharedWithYou` navigates there.

- [ ] **Step 1: Write the failing route test**

Create `mobile/__tests__/app/book-shared.test.tsx`:

```tsx
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "b1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
jest.mock("@/components/PageContainer", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/api/client", () => ({
  getSharedDraft: jest.fn(),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn().mockResolvedValue({}),
}));
jest.mock("@/components/TopicReadList", () => ({
  TopicReadList: ({ book, onOpen }: { book: { title: string }; onOpen: (id: string) => void }) => {
    const { Text, Pressable } = require("react-native");
    return <Pressable accessibilityLabel="open-topic" onPress={() => onOpen("t1")}><Text>INDEX:{book.title}</Text></Pressable>;
  },
}));
jest.mock("@/components/LessonRenderer", () => ({
  TopicRenderer: ({ topic }: { topic: { label: string } }) => {
    const { Text } = require("react-native");
    return <Text>TOPIC:{topic.label}</Text>;
  },
}));
import * as api from "@/api/client";
import SharedDraftReader from "@/../app/book/shared/[id]";

const draft = { book_json: { id: "b1", title: "Shared Book", toc: { subjects: [] }, content: { t1: { label: "Chapter One" } } }, title: "Shared Book", version: "1.0", access: "invited" };

beforeEach(() => {
  jest.clearAllMocks();
  (api.listComments as jest.Mock).mockResolvedValue([]);
  (api.getSharedDraft as jest.Mock).mockResolvedValue(draft);
});

it("loads the draft and renders its contents", async () => {
  render(<SharedDraftReader />);
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
});

it("opens a topic full-screen and returns to contents", async () => {
  render(<SharedDraftReader />);
  fireEvent.press(await screen.findByLabelText("open-topic"));
  await waitFor(() => expect(screen.getByText("TOPIC:Chapter One")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("Back to contents"));
  await waitFor(() => expect(screen.getByText("INDEX:Shared Book")).toBeTruthy());
});

it("shows an error when the draft can't be loaded", async () => {
  (api.getSharedDraft as jest.Mock).mockRejectedValue(new Error("nope"));
  render(<SharedDraftReader />);
  await waitFor(() => expect(screen.getByText(/Couldn't load this draft/i)).toBeTruthy());
});

it("posts a comment from the contents view", async () => {
  render(<SharedDraftReader />);
  await screen.findByText("INDEX:Shared Book");
  fireEvent.changeText(screen.getByLabelText("Add a comment"), "nice");
  fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(api.postComment).toHaveBeenCalledWith("b1", "1.0", "nice", "tok"));
});
```

- [ ] **Step 2: Run to verify fail**

Run (from `mobile/`): `npx jest __tests__/app/book-shared.test.tsx`
Expected: FAIL — `app/book/shared/[id]` module not found.

- [ ] **Step 3: Create the reader route**

Create `mobile/app/book/shared/[id].tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getSharedDraft, listComments, postComment, type DraftComment } from "@/api/client";
import { TopicReadList } from "@/components/TopicReadList";
import { TopicRenderer } from "@/components/LessonRenderer";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Full-screen, read-only reader for a draft shared with the signed-in user
// (ADR-027 D2–D4). Same reading UI as the Studio book screen — a contents list
// that opens each topic full-width — plus the comment thread. Sourced from the
// server-fetched draft, so it needs no local copy of the book.
export default function SharedDraftReader(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [version, setVersion] = useState("1.0");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!id || !accessToken) {
        if (mounted) {
          setError("Sign in to read shared drafts.");
          setLoading(false);
        }
        return;
      }
      try {
        const res = await getSharedDraft(id, accessToken);
        const v = res.version ?? "1.0";
        if (!mounted) return;
        setBook(res.book_json as Book);
        setVersion(v);
        setComments(await listComments(id, v, accessToken));
      } catch {
        if (mounted) setError("Couldn't load this draft.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id, accessToken]);

  const onPost = useCallback(
    (body: string) => {
      if (!id || !accessToken) return;
      void postComment(id, version, body, accessToken)
        .then(() => listComments(id, version, accessToken))
        .then(setComments)
        .catch(() => setError("Couldn't post your comment."));
    },
    [id, version, accessToken],
  );

  if (loading) {
    return (
      <PageContainer>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </PageContainer>
    );
  }

  if (error || !book) {
    return (
      <PageContainer>
        <View style={styles.centered}>
          <Text style={styles.error}>{error ?? "This draft is unavailable."}</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backBtn}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </View>
      </PageContainer>
    );
  }

  const topic = topicId && book.content ? book.content[topicId] : null;

  return (
    <PageContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{book.title}</Text>
        {topic ? (
          <View style={styles.topicWrap}>
            <Pressable onPress={() => setTopicId(null)} accessibilityRole="button" accessibilityLabel="Back to contents">
              <Text style={styles.back}>← Contents</Text>
            </Pressable>
            <TopicRenderer topic={topic} />
          </View>
        ) : (
          <>
            <TopicReadList book={book} onOpen={setTopicId} />
            <Text style={styles.commentsHeader}>Comments</Text>
            <DraftCommentThread comments={comments} isOwner={false} onPost={onPost} />
          </>
        )}
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  error: { fontSize: typography.sizeMd, color: colors.textSecondary, textAlign: "center" },
  backBtn: { backgroundColor: colors.surfaceHigh, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  backBtnText: { color: colors.text, fontWeight: "700", fontSize: typography.sizeSm },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: typography.sizeXl, fontWeight: "700", color: colors.text },
  topicWrap: { gap: spacing.sm },
  back: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.primary },
  commentsHeader: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, marginTop: spacing.md },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/app/book-shared.test.tsx` → PASS (4). `npm run typecheck` → clean.

- [ ] **Step 5: Simplify `SharedWithYou` to navigate**

Replace `mobile/src/components/SharedWithYou.tsx` entirely with:

```tsx
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { sharedWithMe, type SharedItem } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Library-tab section listing drafts other authors shared with the signed-in
// user (ADR-027 D2–D4). Self-hides when signed out or empty; refetches on focus.
// Tapping a draft opens the full-screen reader (/book/shared/[id]).
export function SharedWithYou({ token }: { token: string | null }): React.JSX.Element | null {
  const [items, setItems] = useState<SharedItem[]>([]);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!token) {
          setItems([]);
          return;
        }
        try {
          setItems(await sharedWithMe(token));
        } catch {
          setItems([]);
        }
      })();
    }, [token]),
  );

  if (!token || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Shared with you</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => router.push(`/book/shared/${it.book_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open shared draft: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={styles.itemMeta}>v{it.version}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  itemMeta: { fontSize: typography.sizeXs, color: colors.textMuted },
});
```

- [ ] **Step 6: Rewrite the `SharedWithYou` test**

Replace `mobile/__tests__/components/SharedWithYou.test.tsx` with:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SharedWithYou } from "@/components/SharedWithYou";

jest.mock("@/api/client", () => ({ sharedWithMe: jest.fn() }));
const push = jest.fn();
const mockFocus: { run: (() => void) | null } = { run: null };
jest.mock("expo-router", () => ({
  useRouter: () => ({ push }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    mockFocus.run = cb;
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import * as api from "@/api/client";

beforeEach(() => {
  jest.clearAllMocks();
  (api.sharedWithMe as jest.Mock).mockResolvedValue([
    { book_id: "b1", title: "Shared Book", owner_sub: "o", version: "1.0", updated_at: "" },
  ]);
});

it("renders nothing when signed out", () => {
  expect(render(<SharedWithYou token={null} />).toJSON()).toBeNull();
});

it("renders nothing when the shared list is empty", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(api.sharedWithMe).toHaveBeenCalled());
  expect(screen.queryByText(/Shared with you/i)).toBeNull();
});

it("navigates to the full-screen reader when a draft is tapped", async () => {
  render(<SharedWithYou token="tok" />);
  fireEvent.press(await screen.findByLabelText("Open shared draft: Shared Book"));
  expect(push).toHaveBeenCalledWith("/book/shared/b1");
});
```

- [ ] **Step 7: Run to verify pass + typecheck + lint**

Run: `npx jest __tests__/components/SharedWithYou.test.tsx __tests__/app/book-shared.test.tsx` → PASS.
Run: `npm run typecheck` → clean. `npx eslint "app/book/shared/[id].tsx" src/components/SharedWithYou.tsx` → no new errors.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/book/shared/\[id\].tsx mobile/src/components/SharedWithYou.tsx mobile/__tests__/app/book-shared.test.tsx mobile/__tests__/components/SharedWithYou.test.tsx
git commit -m "feat(sharing): full-screen recipient reader; SharedWithYou navigates to it"
```

---

### Task 2: Studio feedback badge + remove Library list

**Files:**
- Create: `mobile/src/components/FeedbackBadge.tsx`, `mobile/__tests__/components/FeedbackBadge.test.tsx`
- Modify: `mobile/app/(tabs)/books.tsx` (+ `mobile/__tests__/screens/books-feedback.test.tsx` new), `mobile/app/(tabs)/library.tsx`
- Delete: `mobile/src/components/DraftReviews.tsx`, `mobile/__tests__/components/DraftReviews.test.tsx`

**Interfaces:**
- Consumes: `myDrafts` + `DraftReview` (`@/api/client`); `ShareDraftModal`; `loadBook`; `useAuth`; `Alert`.
- Produces: `FeedbackBadge` component; a comment badge on Studio book rows opening `ShareDraftModal`.

- [ ] **Step 1: Write the failing `FeedbackBadge` test**

Create `mobile/__tests__/components/FeedbackBadge.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FeedbackBadge } from "@/components/FeedbackBadge";

it("renders nothing when count is 0", () => {
  expect(render(<FeedbackBadge count={0} onPress={jest.fn()} />).toJSON()).toBeNull();
});

it("shows the count and fires onPress without bubbling", () => {
  const onPress = jest.fn();
  render(<FeedbackBadge count={3} onPress={onPress} />);
  expect(screen.getByText("3")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Feedback: 3 comments"));
  expect(onPress).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx jest __tests__/components/FeedbackBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FeedbackBadge`**

Create `mobile/src/components/FeedbackBadge.tsx`:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A 💬 comment-count badge for a book that has draft-sharing feedback. Tapping
// it opens that book's feedback; it stops press propagation so it doesn't also
// trigger the row it sits on.
export function FeedbackBadge({ count, onPress }: { count: number; onPress: () => void }): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Feedback: ${count} ${count === 1 ? "comment" : "comments"}`}
      hitSlop={6}
      style={styles.badge}
    >
      <Text style={styles.icon}>💬</Text>
      <Text style={styles.count}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.growthTint ?? colors.surfaceHigh,
  },
  icon: { fontSize: typography.sizeXs },
  count: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.growth },
});
```
Note: if `colors.growthTint` doesn't exist in `@/constants/theme`, drop the `?? ` and use `colors.surfaceHigh` (confirm the token by reading `mobile/src/constants/theme.ts`).

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/components/FeedbackBadge.test.tsx` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Write the failing Studio-feedback test**

Create `mobile/__tests__/screens/books-feedback.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
jest.mock("@/storage/bookStore", () => ({
  loadBookIndex: jest.fn().mockResolvedValue([{ id: "b1", title: "My Draft", updatedAt: "" }]),
  loadBook: jest.fn().mockResolvedValue({ id: "b1", title: "My Draft" }),
  deleteBook: jest.fn(),
  hasRenderableLesson: jest.fn().mockReturnValue(true),
}));
jest.mock("@/api/client", () => ({
  myDrafts: jest.fn().mockResolvedValue([{ book_id: "b1", title: "My Draft", version: "1.0", comment_count: 2, last_comment_at: null }]),
}));
jest.mock("@/components/ShareDraftModal", () => ({
  ShareDraftModal: ({ visible, book }: { visible: boolean; book: { title: string } }) => {
    const { Text } = require("react-native");
    return visible ? <Text>MODAL:{book.title}</Text> : null;
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import BooksScreen from "@/../app/(tabs)/books";

it("shows a feedback badge on a book with comments and opens its Share modal", async () => {
  render(<BooksScreen />);
  const badge = await screen.findByLabelText("Feedback: 2 comments");
  fireEvent.press(badge);
  await waitFor(() => expect(screen.getByText("MODAL:My Draft")).toBeTruthy());
});
```
(If `books.tsx` imports something this mock set doesn't cover and the render throws, add the missing module to the mocks — the point is to reach the row render with a `myDrafts`-backed badge. Keep the two assertions.)

- [ ] **Step 6: Run to verify fail**

Run: `npx jest __tests__/screens/books-feedback.test.tsx`
Expected: FAIL — no "Feedback: 2 comments" badge yet.

- [ ] **Step 7: Wire the badge into `books.tsx`**

In `mobile/app/(tabs)/books.tsx`, inside `BooksScreenInner`:
1. Add imports at the top of the file:
   ```tsx
   import { useAuth } from "@/auth/AuthProvider";
   import { myDrafts } from "@/api/client";
   import { ShareDraftModal } from "@/components/ShareDraftModal";
   import { FeedbackBadge } from "@/components/FeedbackBadge";
   import { Alert } from "@/lib/alert";
   import type { Book } from "@/types/book";
   ```
   (Some may already be imported — don't duplicate. `loadBook` is already imported.)
2. Add state + token near the other `useState`s in `BooksScreenInner`:
   ```tsx
   const { accessToken } = useAuth();
   const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
   const [feedbackBook, setFeedbackBook] = useState<Book | null>(null);
   ```
3. Inside the existing `useFocusEffect` callback (the one that calls `loadBookIndex`), append a myDrafts fetch:
   ```tsx
   if (accessToken) {
     myDrafts(accessToken)
       .then((rows) => setCommentCounts(Object.fromEntries(rows.map((r) => [r.book_id, r.comment_count]))))
       .catch(() => setCommentCounts({}));
   } else {
     setCommentCounts({});
   }
   ```
   and add `accessToken` to that `useCallback`'s dependency array.
4. Add an `openFeedback` callback next to `openBook`:
   ```tsx
   const openFeedback = useCallback(async (id: string) => {
     const book = await loadBook(id);
     if (!book) {
       Alert.alert("Not on this device", "Open this book from your Library to review its feedback.");
       return;
     }
     setFeedbackBook(book);
   }, []);
   ```
5. In **both** row `renderItem`s (the `isDesktop` FlatList near line 261 and the mobile FlatList near line 302), render the badge next to the existing `<ExportStatusPills … />`:
   ```tsx
   <FeedbackBadge count={commentCounts[item.id] ?? 0} onPress={() => openFeedback(item.id)} />
   ```
6. Render the modal once, at the end of both returned trees (or wrap the outer return) — the simplest is to render it inside a fragment alongside each `FlatList` return:
   ```tsx
   {feedbackBook && accessToken ? (
     <ShareDraftModal visible book={feedbackBook} token={accessToken} onClose={() => setFeedbackBook(null)} />
   ) : null}
   ```
   Add it to both the desktop `return (<View style={styles.split}>…)` and the mobile `return (<FlatList …/>)` — for the mobile one, wrap the `FlatList` + modal in a `<>…</>` fragment so both render.

- [ ] **Step 8: Run to verify pass**

Run: `npx jest __tests__/screens/books-feedback.test.tsx` → PASS. `npm run typecheck` → clean.

- [ ] **Step 9: Remove the Library `DraftReviews` section + delete the component**

In `mobile/app/(tabs)/library.tsx`: remove the `import { DraftReviews } from "@/components/DraftReviews";` line and both `<DraftReviews token={accessToken} />` renders (the empty-library branch and the FlatList header). Leave `<SharedWithYou … />` in place.

Delete the files:
```bash
git rm mobile/src/components/DraftReviews.tsx mobile/__tests__/components/DraftReviews.test.tsx
```

- [ ] **Step 10: Run to verify pass + full suite + typecheck + lint**

Run: `npx jest` → full suite green (DraftReviews tests gone; new FeedbackBadge + books-feedback pass).
Run: `npm run typecheck` → clean. `npx eslint src/components/FeedbackBadge.tsx "app/(tabs)/books.tsx" "app/(tabs)/library.tsx"` → no new errors.

- [ ] **Step 11: Commit**

```bash
git add mobile/src/components/FeedbackBadge.tsx mobile/__tests__/components/FeedbackBadge.test.tsx mobile/__tests__/screens/books-feedback.test.tsx mobile/app/\(tabs\)/books.tsx mobile/app/\(tabs\)/library.tsx
git commit -m "feat(sharing): feedback badge on Studio books; remove Library feedback section"
```

---

## Self-Review

**Spec coverage:**
- Full-screen recipient reader route reusing TopicReadList/TopicRenderer + comment thread → Task 1 (route) + tests. ✔
- SharedWithYou becomes a plain list that navigates → Task 1 Step 5/6. ✔
- 💬 count badge on Studio book rows → ShareDraftModal → Task 2 (FeedbackBadge + books.tsx wiring, both renderItems). ✔
- Badge stops row-press propagation → Task 2 Step 3 (`e.stopPropagation`). ✔
- loadBook-null → Alert → Task 2 Step 7.4. ✔
- Remove DraftReviews from Library + delete component/test; keep `myDrafts` → Task 2 Steps 9. ✔
- Refetch on focus (both surfaces) → Task 1 SharedWithYou `useFocusEffect`; Task 2 badge fetch inside books.tsx `useFocusEffect`. ✔

**Placeholder scan:** none — full code for the route, both components, the SharedWithYou rewrite, and the FeedbackBadge; the books.tsx wiring is numbered concrete edits into two known renderItems (the file is large + responsive, so edits are described against its real structure and verified by the test + typecheck). ✔

**Type consistency:** `getSharedDraft` → `{ book_json, title, version }` cast `as Book`; `DraftReview` (`{book_id, comment_count, …}`) drives `commentCounts: Record<string, number>`; `FeedbackBadge` props `{ count: number; onPress: () => void }` match usage; `ShareDraftModal` props `{ visible, book, token, onClose }` consistent; `TopicRenderer` takes `{ topic }` from `book.content[topicId]`. ✔
