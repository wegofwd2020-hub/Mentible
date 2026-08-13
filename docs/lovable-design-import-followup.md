# Followup — Import a Lovable design into Mentible

**Status:** Not started — captured 2026-08-10 for later followup.
**Goal:** Take a design built in Lovable and produce a design spec we can implement in Mentible.

---

## The question

Can Claude access a Lovable site we designed, spec the design out, and let us implement it in Mentible? **Yes** — feasible via the same Chrome browser hook used for other browser tasks, or (better) by reading the exported source.

---

## Two routes (best → fallback)

### Route A — read the source *(preferred, exact)*
Lovable projects export/sync to **GitHub** (React + Tailwind, usually shadcn/ui).
Give Claude the repo (or connect it) → read the actual components + `tailwind.config`
→ **exact** spec: real color tokens, type scale, spacing, radii, component structure.
No guessing, source-of-truth.

### Route B — browser-inspect the live site *(fallback, reverse-engineered)*
Claude navigates the **published Lovable URL**, screenshots, reads DOM + computed styles
→ derives the spec from what renders. Good, but pixel-derived, not authoritative.

---

## What the design spec will contain
- **Design tokens** — colors, fonts/type scale, spacing, radii, shadows
- **Component catalog** — every distinct UI component + its variants/states
- **Page layouts** — structure per screen
- **States & interactions** — hover/press/focus/disabled, transitions
- **Responsive behavior** — breakpoints (web) → how they map on mobile

Output = a design doc the team (or Claude) implements against.

---

## Caveats to plan around

1. **Auth boundary.** Claude cannot enter credentials (prohibited). If it's the Lovable
   *editor* (login-walled), Route B won't reach it — use the **published preview URL**
   (normally public) or Route A (the repo), which sidesteps auth entirely.

2. **Web → mobile translation gap.** Lovable ships **web** (React DOM + CSS Tailwind).
   Mentible is **Expo / React Native** — no DOM, no CSS Tailwind (would be **NativeWind**
   or `StyleSheet`). So the design can't be lifted 1:1; it becomes *design intent + tokens*
   re-implemented in RN primitives. Layout (flexbox) ports cleanly; CSS-only niceties
   (some selectors, hover, certain effects) need RN equivalents — Claude flags these in the spec.

3. **Scope.** "Spec the design" = extract + document. **Building** it into Mentible is a
   separate effort → runs through brainstorming → spec → SDD like other Mentible work.

---

## To kick it off, provide:
- [ ] The **repo** (Route A, preferred) **or** the **published Lovable URL** (Route B)
- [ ] Which **Mentible surface** it targets — mobile app vs web
- [ ] (optional) Which screens/flows to prioritize

Then Claude produces the design spec.
