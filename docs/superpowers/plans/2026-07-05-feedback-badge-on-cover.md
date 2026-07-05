# Feedback Badge on the Book Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the author's 💬 comment indicator from the small grey meta-row pill to a prominent filled badge on the book cover's top-left corner, in both Studio layouts.

**Architecture:** Restyle `FeedbackBadge` (filled growth-green + an optional `style` prop for positioning) and, in `books.tsx`, render it as an absolute overlay on the cover corner in both renderItems instead of in the meta row. Mobile-only; the `myDrafts`/`openFeedback`/`ShareDraftModal` wiring is unchanged.

**Tech Stack:** React Native + Expo · TypeScript · Jest + @testing-library/react-native.

## Global Constraints

- `FeedbackBadge` keeps its contract: `null` when `count ≤ 0`; `e.stopPropagation` on press; accessibilityLabel `Feedback: {n} comment(s)`. Add an optional `style?: StyleProp<ViewStyle>` merged onto the badge container.
- Filled + colored: `backgroundColor: colors.growth`, text/icon color `colors.growthText`; theme tokens only, no hardcoded colors (a `shadow*`/`elevation` for separation is fine).
- Overlay position: cover **top-left** (`top: 6, left: 6`, `position: "absolute"`, `zIndex: 2`) — the cover's existing progress badge is top-right (`BookCover` renders it at `top: 8, right: 8`), so no collision.
- Applied in **both** Studio renderItems (desktop split-pane row ~line 292; mobile tile ~line 338). Remove `FeedbackBadge` from the `rowMetaRow` in both; leave `ExportStatusPills` there.
- Mobile cmds from `mobile/`. `npx jest <path>`, `npm run typecheck`, `npx eslint <files>`; full `npx jest` at the end.

---

### Task 1: Feedback badge on the cover

**Files:**
- Modify: `mobile/src/components/FeedbackBadge.tsx`, `mobile/app/(tabs)/books.tsx`
- Test: `mobile/__tests__/components/FeedbackBadge.test.tsx` (extend)

**Interfaces:**
- Consumes: `colors`/`radius`/`spacing`/`typography` (`@/constants/theme`); `BookCover`, `ExportStatusPills`, `commentCounts`/`openFeedback` (already in `books.tsx`).
- Produces: `FeedbackBadge({ count, onPress, style? })` positionable; the badge rendered on the cover corner in both renderItems.

- [ ] **Step 1: Extend the FeedbackBadge test**

Add this case to `mobile/__tests__/components/FeedbackBadge.test.tsx` (keep the two existing cases):

```tsx
it("accepts a style prop and still renders the count and fires onPress", () => {
  const onPress = jest.fn();
  render(<FeedbackBadge count={2} onPress={onPress} style={{ position: "absolute", top: 6, left: 6 }} />);
  expect(screen.getByText("2")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Feedback: 2 comments"));
  expect(onPress).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `mobile/`): `npx jest __tests__/components/FeedbackBadge.test.tsx`
Expected: FAIL — TypeScript/prop error: `FeedbackBadge` has no `style` prop (or the test type-errors). (If jest doesn't type-check and it passes, still proceed — Step 4 adds the prop; verify `npm run typecheck` fails without it.)

- [ ] **Step 3: Restyle + add the `style` prop to FeedbackBadge**

Replace `mobile/src/components/FeedbackBadge.tsx` with:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A prominent 💬 comment-count badge for a book that has draft-sharing feedback.
// Overlaid on the book cover (positioned by the caller via `style`). Tapping it
// opens that book's feedback; it stops press propagation so it doesn't also
// trigger the cover/row it sits on.
export function FeedbackBadge({
  count,
  onPress,
  style,
}: {
  count: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Feedback: ${count} ${count === 1 ? "comment" : "comments"}`}
      hitSlop={8}
      style={[styles.badge, style]}
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
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.growth,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.growthText,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  icon: { fontSize: typography.sizeXs },
  count: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.growthText },
});
```
(Confirm `colors.growthText` exists in `mobile/src/constants/theme.ts` — it does, alongside `colors.growth`. If for any reason it's absent, use `colors.white` for the text/border.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/components/FeedbackBadge.test.tsx` → PASS (3). `npm run typecheck` → clean.

- [ ] **Step 5: Reposition the badge onto the cover in both renderItems (`books.tsx`)**

In `mobile/app/(tabs)/books.tsx`:

**(a) Desktop renderItem** (~line 301-312). The cover already has a `rowCover` wrapper — put the badge inside it and remove it from the meta row:
```tsx
                <View style={styles.rowCover}>
                  <BookCover title={item.title} badge={progressLabel(item)} coverSvg={item.coverSvg} />
                  <FeedbackBadge count={commentCounts[item.id] ?? 0} onPress={() => openFeedback(item.id)} style={styles.coverBadge} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.rowMeta}>
                    {item.unitCount} topic{item.unitCount === 1 ? "" : "s"} · {formatDate(item.updatedAt)}
                  </Text>
                  <View style={styles.rowMetaRow}>
                    <ExportStatusPills status={exportStatus[item.id]} bookUpdatedAt={item.updatedAt} published={published[item.id]} />
                  </View>
                </View>
```

**(b) Mobile tile renderItem** (~line 345-351). Wrap the bare `BookCover` in a relative container with the badge, and remove it from the meta row:
```tsx
            <View style={styles.coverWrap}>
              <BookCover title={item.title} badge={progressLabel(item)} coverSvg={item.coverSvg} />
              <FeedbackBadge count={commentCounts[item.id] ?? 0} onPress={() => openFeedback(item.id)} style={styles.coverBadge} />
            </View>
            <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.tileMeta}>{item.unitCount} topics</Text>
            <View style={styles.rowMetaRow}>
              <ExportStatusPills status={exportStatus[item.id]} bookUpdatedAt={item.updatedAt} published={published[item.id]} />
            </View>
```

**(c) Styles.** Ensure `rowCover` is a positioning context and add `coverWrap` + `coverBadge` to the `StyleSheet.create({...})` in `books.tsx`:
- If `rowCover` exists, add `position: "relative"` to it (merge into its existing style object). If it has no explicit width/self, it already wraps the thumb cover — fine.
- Add:
  ```tsx
  coverWrap: { position: "relative", alignSelf: "flex-start" },
  coverBadge: { position: "absolute", top: 6, left: 6, zIndex: 2 },
  ```

- [ ] **Step 6: Verify the Studio badge test still passes**

Run: `npx jest __tests__/screens/books-feedback.test.tsx` → PASS (the badge moved onto the cover but keeps the same accessibilityLabel `Feedback: 2 comments` + opens `ShareDraftModal`, so the existing assertions hold).

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `npx jest` → full suite green. `npm run typecheck` → clean. `npx eslint src/components/FeedbackBadge.tsx "app/(tabs)/books.tsx"` → no new errors.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/FeedbackBadge.tsx mobile/app/\(tabs\)/books.tsx mobile/__tests__/components/FeedbackBadge.test.tsx
git commit -m "feat(sharing): feedback badge on the book cover (both Studio layouts)"
```

---

## Self-Review

**Spec coverage:**
- Badge overlaid on the cover top-left (top-right progress badge untouched) → Step 5 (`coverBadge` top:6/left:6). ✔
- Filled + colored + larger vs the grey pill → Step 3 (growth bg, growthText, sizeSm, shadow). ✔
- Tappable → ShareDraftModal, stops propagation → Step 3 (`e.stopPropagation`) + Step 5 (`openFeedback`). ✔
- Removed from `rowMetaRow`; `ExportStatusPills` stays → Step 5 (a) + (b). ✔
- Both renderItems → Step 5 (a) desktop + (b) mobile. ✔
- `BookCover` stays generic (overlay done in books.tsx) → Step 5 (no BookCover change). ✔
- Tests: FeedbackBadge style case + books-feedback still passes → Steps 1, 6. ✔

**Placeholder scan:** none — full FeedbackBadge code + exact old/new books.tsx blocks + concrete styles. The `colors.growthText` token is confirmed present with a stated fallback. ✔

**Type consistency:** `FeedbackBadge` now `{ count, onPress, style? }`; both call sites pass `style={styles.coverBadge}`; `coverWrap`/`coverBadge` styles referenced match their definitions; `colors.growth`/`colors.growthText` used consistently. ✔
