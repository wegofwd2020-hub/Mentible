# Feedback badge on the book cover — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Extends:** the draft-sharing "Author Reviews" surface — the `FeedbackBadge` on Studio book rows (merged). Mobile-only, no backend change.

## Summary

The author's comment indicator is currently a small, grey `💬 N` pill tucked in the
bottom meta row of each Studio book tile, next to the export pills — hard to notice.
Move it to a **prominent, filled badge overlaid on the book cover's corner**, so it
clearly reads as "this book has feedback." Applies to both Studio layouts (mobile tile +
desktop row).

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| 1 | The feedback indicator sits **on the book cover**, as an absolute-positioned corner overlay — the **top-left** corner (the cover's existing progress badge, e.g. "12/16", is top-right, so no collision). |
| 2 | **Filled + colored** (growth-green background, light text) and slightly larger than the current muted grey pill — it must stand out on the cover art. |
| 3 | Still tappable → opens that book's `ShareDraftModal`; **stops press propagation** so it doesn't also open the book (unchanged behavior). |
| 4 | **Removed** from the bottom `rowMetaRow`; `ExportStatusPills` stays where it is. |
| 5 | Applied in **both** Studio renderItems (desktop row + mobile tile). `BookCover` stays generic — the overlay is done in `books.tsx` around the cover, not baked into `BookCover`. |

## Design

### `mobile/src/components/FeedbackBadge.tsx` (restyle + positionable)
- Keep the component + its contract (`{ count, onPress }`, null when `count ≤ 0`,
  `e.stopPropagation`, accessibilityLabel `Feedback: {n} comment(s)`).
- **Restyle** to a filled, prominent pill: `backgroundColor: colors.growth`, text/icon in
  `colors.growthText` (or `colors.white`), a bit larger (`typography.sizeSm`), rounded, with
  a subtle shadow/border so it reads on any cover.
- Add an optional **`style?: StyleProp<ViewStyle>`** prop merged onto the badge container, so
  `books.tsx` can position it absolutely on the cover corner. Default (no style) still renders
  a normal inline pill (keeps the component reusable).

### `mobile/app/(tabs)/books.tsx` (reposition in both renderItems)
- In **both** the desktop renderItem (~line 292, `<BookCover title badge={progressLabel} …/>`)
  and the mobile tile renderItem (~line 338), wrap the `<BookCover … />` in a
  relatively-positioned container and render the `FeedbackBadge` as an absolute overlay on the
  cover's top-left:
  ```tsx
  <View style={styles.coverWrap}>
    <BookCover title={item.title} badge={progressLabel(item)} coverSvg={item.coverSvg} />
    <FeedbackBadge count={commentCounts[item.id] ?? 0} onPress={() => openFeedback(item.id)} style={styles.coverBadge} />
  </View>
  ```
  (desktop uses its existing cover call; mobile uses `styles.tile` cover — wrap each accordingly).
- **Remove** the `FeedbackBadge` from the `rowMetaRow` in both renderItems; leave
  `ExportStatusPills` in the meta row (if that leaves `rowMetaRow` holding only the pills, keep
  the row — it's still the pills' home).
- New styles: `coverWrap: { position: "relative", alignSelf: "flex-start" }` (so the overlay
  anchors to the cover, not the full tile width); `coverBadge: { position: "absolute", top: 6,
  left: 6, zIndex: 2 }`. (`FeedbackBadge` renders `null` at count 0, so no empty overlay.)

## Scope

**In scope:** `FeedbackBadge` restyle + optional `style` prop; reposition onto the cover in both
Studio renderItems; remove from the meta row.
**Out of scope:** backend (unchanged); the `myDrafts` fetch / `openFeedback` / `ShareDraftModal`
wiring (already built, reused as-is); the recipient reader; `BookDetail`'s large cover (line 128)
— the row covers are the discovery surface; adding it to the detail panel is a possible later touch,
not this.

## Testing

- **`FeedbackBadge` test** (`mobile/__tests__/components/FeedbackBadge.test.tsx`): keep the
  existing cases (null at 0; renders count; `onPress` fires without bubbling). Add: passing a
  `style` prop still renders the count + fires `onPress` (the badge is positionable).
- **Studio badge test** (`mobile/__tests__/screens/books-feedback.test.tsx`): unchanged
  assertions still pass — the badge (now on the cover) still renders `Feedback: 2 comments` and
  tapping it opens `ShareDraftModal` without opening the book. (Its position moved; its label +
  behavior didn't.)
- Full mobile suite + `tsc` + lint green.

## Files
- Modify: `mobile/src/components/FeedbackBadge.tsx`, `mobile/app/(tabs)/books.tsx`
- Modify (tests): `mobile/__tests__/components/FeedbackBadge.test.tsx` (add the style case)

## Rollout
Mobile-only, no migration. Ships in the next web deploy + the next APK (vc8). One phase.
