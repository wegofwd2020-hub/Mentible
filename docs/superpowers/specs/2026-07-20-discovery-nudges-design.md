# Discovery Nudges — Advertise the Moat (F3) — Design

**Date:** 2026-07-20
**Status:** Approved
**Branch:** `feat/discovery-nudges` (main-track; mergeable)
**Context:** Open Shelves F1 (read) + F2 (grounded Make-a-quiz) + starter shelves are shipped and live. Nothing surfaces the moat to users.

## Goal

Make users discover the moat — **get a free book (starter shelves / import) → read it → make a quiz grounded in *that* book** — through small, proactive, in-context nudges at the moment of relevance. Onboarding today teaches "read a book we gave you"; it never advertises the grounded-quiz payoff, so users don't find it.

## Why a new primitive (not `HelpHint`)

`mobile/src/help/components/HelpHint.tsx` is a **passive** "?" affordance: tap-to-reveal, explains a control the user is *already looking at*. Advertising a moat is the opposite problem — reaching someone who doesn't know the feature exists. That needs a **proactive, self-limiting** nudge: it appears on its own, points at the action, and never nags after dismissal. Reusing `HelpHint` would quietly fail the goal. No dismissible-banner / spotlight / coachmark pattern exists in the codebase today (verified), so we build a small one.

## Decisions

### D1: The nudge is proactive, dismissible, and shows at most until first dismiss
A nudge renders whenever it is *eligible* (its caller condition is true AND it hasn't been dismissed). Dismissal is **persisted per key**, so each nudge is a one-time, self-limiting callout — never a recurring nag. There is no "show N times" logic (YAGNI); once dismissed, gone.

### D2: Two placements — the moat funnel
| Key | Screen | Copy | Eligible when |
|---|---|---|---|
| `chapter-quiz` | Reading screen (`book/chapter/[bookId]/[chapterId].tsx`), adjacent to the quiz trigger | "New — make a quiz from this chapter to test yourself." | the quiz trigger is shown — i.e. gate the nudge on the *same* `showTrigger` value (currently `!IS_DEMO`), so the nudge appears exactly when the action it advertises is available, and never in the demo |
| `shelves-download` | Shelves tab (`app/(tabs)/shelves.tsx`), above the sources list | "Tap a curated shelf to download a free book to read." | at least one starter (`isStarter`) source is present |

`chapter-quiz` is the **core** nudge — it advertises the actual moat (a grounded quiz on the user's own book). `shelves-download` feeds the funnel (get a book in). A Library "get more books" nudge is **out of scope** (YAGNI — the first-run tour already names Library, and two funnel nudges are enough to prove the loop).

### D3: No new Help `FEATURES` key
Nudges advertise features that **already have Help topics** (Open Shelves, reading a book / making a quiz). They are a discovery layer, not a feature users look up in Help. So we add **no** `FEATURES` entry — which means the Help coverage gate (`coverage.test.ts`) and the starter-claim gate are untouched. (Adding a `FEATURES` key would force a topic; we deliberately don't.)

### D4: Fail closed, never crash
The dismissed-set load is async AsyncStorage I/O. Until it resolves, a nudge is **hidden** (not flashed). If the load throws, the nudge simply never shows — a discovery hint failing to appear is invisible; it must never crash a screen or block reading. Dismissal write failures are swallowed (worst case the nudge reappears next launch).

### D5: Web + native
AsyncStorage works on both (localStorage-backed on web). The `chapter-quiz` nudge inherits the trigger's existing `!IS_DEMO` gate, so it never appears in the read-only demo (where the quiz action is hidden anyway).

## Architecture

Three small units.

### A1: `nudgeStore.ts` — persisted dismissed-set (data)
`mobile/src/discovery/nudgeStore.ts`
- AsyncStorage key `sbq_dismissed_nudges`, holding a JSON array of dismissed nudge keys.
- `loadDismissed(): Promise<string[]>` — parse-safe, returns `[]` on missing/corrupt.
- `dismissNudge(key: string): Promise<void>` — append `key` if absent, persist.
- Mirrors the seed-marker style (`seedStarterSources`'s marker, `seedLibrary`).

### A2: `useNudge(key)` — the hook (behavior)
`mobile/src/discovery/useNudge.ts`
- `useNudge(key: string): { visible: boolean; dismiss: () => void }`.
- Loads the dismissed set once on mount; `visible` starts `false` and becomes `true` only if the key is absent from the loaded set (D4 — hidden until resolved).
- `dismiss()` optimistically sets `visible = false` and calls `dismissNudge(key)` (swallowing errors).
- The **caller** owns the eligibility condition (e.g. `showTrigger`, "starter present") and only renders `<DiscoveryNudge>` when both its condition and `visible` are true.

### A3: `DiscoveryNudge` — the component (presentation)
`mobile/src/discovery/DiscoveryNudge.tsx`
- Props: `{ text: string; onDismiss: () => void; testID?: string }`.
- Renders a themed callout row: a sparkle/lightbulb `Ionicons` glyph, the one-line `text`, and a dismiss `Pressable` ("×") calling `onDismiss`. Uses `@/constants/theme` tokens. No CTA/navigation in v1 — it sits next to the real control it advertises (spotlight, not a router). Accessible: dismiss button has an `accessibilityLabel`.

### Wiring
- **Reading screen:** `const q = useNudge("chapter-quiz");` render `{showTrigger && q.visible && <DiscoveryNudge text="New — make a quiz from this chapter to test yourself." onDismiss={q.dismiss} testID="nudge-chapter-quiz" />}` directly above the existing quiz trigger block.
- **Shelves:** `const s = useNudge("shelves-download");` render `{hasStarter && s.visible && <DiscoveryNudge text="Tap a curated shelf to download a free book to read." onDismiss={s.dismiss} testID="nudge-shelves-download" />}` above the sources list, where `hasStarter = shelves.sources.some(x => x.isStarter)`.

## Error handling
- **Store load fails:** nudge stays hidden (D4). No crash.
- **Dismiss write fails:** swallowed; nudge may reappear next launch (acceptable — better than a crash).
- **No content / demo:** the caller's eligibility gate (`showTrigger`, `hasStarter`) prevents an irrelevant nudge; the quiz nudge is demo-safe by construction.

## Testing
| Guarantee | Test |
|---|---|
| Hidden until the dismissed-set loads | `useNudge` starts `visible === false`, becomes `true` after load if key absent |
| Not shown once dismissed | seed the store with the key → `visible` stays `false` |
| Dismiss persists | `dismiss()` writes the key; a fresh `useNudge` then reports `visible === false` |
| Dismiss is idempotent | dismissing an already-dismissed key doesn't duplicate it |
| Load failure fails closed | `loadDismissed` rejects → `visible` stays `false`, no throw |
| `DiscoveryNudge` renders text + dismiss fires | RNTL: text present; press "×" → `onDismiss` called |
| Reading screen: nudge gated on `showTrigger` AND visible | present when eligible+undismissed; absent in demo / when dismissed |
| Shelves: nudge gated on a starter source present AND visible | present with a starter shelf; absent with none |
| No Help coverage regression | `coverage.test.ts` + `starter-claim.test.ts` still pass (no `FEATURES` change) |

No test hits the network. AsyncStorage is jest-auto-mocked.

## Out of scope (deliberately)
- **Library "get more books" nudge** (D2 — YAGNI).
- **Show-N-times / re-surfacing** logic (D1 — one-and-done).
- **A CTA/deep-link inside the nudge** (A3 — it sits next to the real control).
- **A new Help topic / `FEATURES` key** (D3).
- **Analytics on nudge impressions/dismissals** — no telemetry surface exists; not adding one.

## Follow-ups
- If data later shows a nudge is missed, revisit a gentle re-surface (e.g. show again after a long interval) — but only with evidence.
- Consider a `shelves-download` → deep-link into a shelf once there's a reason to (v1 keeps it a pure spotlight).
