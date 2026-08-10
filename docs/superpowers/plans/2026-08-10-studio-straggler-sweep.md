# Studio straggler sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the three surfaces P2 missed — `posts.tsx`, `shelves.tsx`, `CheckoutButton.tsx` — to the P1 Studio primitives + Playfair headings, matching the P2 screens. Typography + control-style only; no behavior change.

**Architecture:** The exact P2 content-sweep pattern (reference `mobile/app/(tabs)/projects.tsx`), applied per file. No new component, no new design.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-10-studio-straggler-sweep-design.md`.
- **Reference = `mobile/app/(tabs)/projects.tsx`.** Heading style: `{ color: c.text, fontSize: typography.sizeLg /* sizeXl for a screen title */, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36 }` with `import { PLAYFAIR } from "@/constants/fonts"`. Controls: `<Button variant="primary"|"ghost">`. Surfaces: `<Card>`. Eyebrows/meta: `<Label tone="muted"|"secondary">`. Import from `@/components/ui` — **only the primitives actually used** (no unused imports).
- **Retire `fontWeight: 600/700`** on headings → Playfair (drop the numeric weight). Playfair **≥16px only**; ≤14px (`sizeXs`/`sizeSm`) labels stay Inter.
- **Ghost-default; one gold `variant="primary"` pill per view maximum.**
- **Keep raw Pressable** for: nav-target rows, controls nesting a `stopPropagation` action, and icon+text controls whose glyph is essential (`Button` has no icon slot).
- **No behavior/data/nav change** — visual only. `useThemedStyles`; **no color-literal test asserts**.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/app/(tabs)/posts.tsx` (T1) · `mobile/app/(tabs)/shelves.tsx` (T2) · `mobile/src/components/CheckoutButton.tsx` (T3)
- Tests: each file's existing test under `mobile/__tests__/` (updated)

---

### Task 1: posts.tsx — primitive sweep

**Files:**
- Modify: `mobile/app/(tabs)/posts.tsx`
- Test: its existing test under `mobile/__tests__/` (update) — or add a thin render test if none

- [ ] **Step 1: READ `posts.tsx` fully + the reference `projects.tsx`.** Identify each of the ~8 `fontWeight:600/700` heading styles, each ad-hoc filled control, each ad-hoc bordered card, and which of its ~11 Pressables are nav-target rows (keep raw) vs standalone action buttons (→ `<Button>`).

- [ ] **Step 2: Update/write the test.** READ the existing posts test; convert any assertion reading a raw heading `<Text>` or raw button into asserting the same content via the primitive (`getByText` still finds a title inside `<Card>`; controls via `getByRole("button",{name})`); assert no rendered heading style carries `fontWeight:"700"` (or the title uses `PLAYFAIR.semibold`). No color literals. If no test exists, add a thin render test (mounts + the one primary action is a single `variant="primary"`).

- [ ] **Step 3: Implement the sweep** (mirror `projects.tsx`): add `import { PLAYFAIR } from "@/constants/fonts";` + `import { Button, Card, Label } from "@/components/ui";` (only what's used). Headings → the Playfair style (drop weight). Ad-hoc bordered `View`s → `<Card style={layoutOnlyStyle}>`. Filled/ad-hoc action buttons → `<Button variant="ghost">` (one `primary` max). Eyebrows/meta → `<Label>`. Keep nav-target/nested Pressables raw; keep ≤14px labels Inter.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Pp]osts" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/posts.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): straggler sweep — posts adopts primitives + Playfair headings"
```

---

### Task 2: shelves.tsx — primitive sweep (keep catalog nav rows raw)

**Files:**
- Modify: `mobile/app/(tabs)/shelves.tsx`
- Test: its existing test (update)

- [ ] **Step 1: READ `shelves.tsx` fully** (~5 raw weights, ~9 Pressables) + `projects.tsx`. This is the Open Shelves catalog: its list rows are **navigation targets → keep raw Pressable**. Only headings, section eyebrows, and standalone action buttons (e.g. add-a-feed / browse actions) get the treatment.

- [ ] **Step 2: Update/write the test** — same rubric as T1 (content survives via primitives; no heading `fontWeight:"700"`; no color literals; **catalog nav behavior assertions stay green and unchanged**).

- [ ] **Step 3: Implement the sweep** — same rubric as T1 applied to `shelves.tsx`. Headings → Playfair; ad-hoc cards → `<Card>`; standalone actions → `<Button>` (ghost default); eyebrows → `<Label>`. **Do NOT convert the catalog list-row Pressables** (nav targets). Keep small labels Inter.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Ss]helves" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/(tabs)/shelves.tsx" mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): straggler sweep — shelves adopts primitives + Playfair headings"
```

---

### Task 3: CheckoutButton.tsx — labeled action → Button, behavior preserved

**Files:**
- Modify: `mobile/src/components/CheckoutButton.tsx`
- Test: its existing test (update)

**Interfaces:**
- Consumes: `Button` from `@/components/ui`.

- [ ] **Step 1: READ `CheckoutButton.tsx` fully** (~2 raw weights, ~5 Pressables) + `projects.tsx` + `mobile/src/components/ui/Button.tsx` (its prop shape). This is the shared EPUB/PDF checkout control used on the read screen. Identify the labeled checkout action(s) (→ `<Button>`) vs any icon-only/nested control (keep raw). Note: the read screen (`book/read/[id].tsx`, P3 T4) already has a gold `primary` download CTA — so CheckoutButton's actions should be `variant="ghost"` unless it's clearly the screen's single primary.

- [ ] **Step 2: Update/write the test.** READ the existing CheckoutButton test; keep its **checkout/onPress behavior assertions intact and unchanged**; convert a raw-button assertion to the `<Button>` primitive (`getByRole("button",{name})`); assert no heading/label carries `fontWeight:"700"` where swept. No color literals.

- [ ] **Step 3: Implement.** `import { Button } from "@/components/ui";`. Convert the labeled checkout action(s) from raw `Pressable`+`Text` to `<Button variant="ghost">` (or `primary` only if it's genuinely the sole primary in its context), preserving `onPress`/label/disabled/busy behavior byte-for-byte. Retire the raw `fontWeight:600/700` on any swept label. Keep any icon-bearing or nested Pressable raw. Do NOT change the checkout flow/props/callbacks.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Cc]heckout" && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/components/CheckoutButton.tsx mobile/__tests__ 2>/dev/null
git commit -m "feat(studio): straggler sweep — CheckoutButton uses the Button primitive"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` (or the repo lint) — full suite green + clean.
- [ ] Grep the three files for a residual heading `fontWeight: "700"`/`"600"` and any leftover unused import.
- [ ] **Device/web screenshot verify** (jsdom is Yoga-blind — the flexbox + Playfair traps only show here; mirror the P2 verify): posts/shelves/read-screen-checkout render Playfair headings, ghost controls, hairline cards, no text-collapse, catalog rows still navigate.
- [ ] PR body: three straggler screens adopt P1 primitives; mobile-only → **web redeploy, no backend**.

## Self-Review

- **Spec coverage:** posts (T1) · shelves w/ nav rows kept raw (T2) · CheckoutButton → Button (T3). Reader/compiler + new behavior out of scope.
- **Type consistency:** all three consume the same `@/components/ui` exports + `PLAYFAIR` from `@/constants/fonts`, the exact imports `projects.tsx` uses.
- **Placeholders:** none — each task names the file, the reference, the mechanical rubric, and the per-file carve-outs (shelves nav rows, CheckoutButton behavior).
- **Constraints:** Playfair ≥16px (small labels stay `<Label>`/Inter); retire 600/700; ghost-default + one gold pill; nav-target/nested Pressables raw; no color-literal asserts; no behavior change; no backend.
