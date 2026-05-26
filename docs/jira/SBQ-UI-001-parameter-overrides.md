# SBQ-UI-001 — Query screen: user overrides and custom parameters

> **Note:** This file is a paste-ready JIRA Story. No JIRA API call was made (no JIRA tooling configured). Copy the body below into Atlassian when creating the issue.

---

## JIRA fields

| Field | Value |
|-------|-------|
| **Project** | StudyBuddy Q (SBQ) |
| **Issue Type** | Story |
| **Summary** | Query screen — let users adjust presets, reset, and add custom parameters in Power Mode |
| **Component** | mobile / Query screen |
| **Labels** | `query-screen`, `parameters`, `power-mode`, `mvp` |
| **Epic Link** | (set to the "Query screen MVP" epic when it exists; otherwise leave unset) |
| **Priority** | High *(blocking the alpha demo build)* |
| **Estimate** | 5 story points *(roughly one sprint-week for one mobile engineer)* |
| **Sprint** | next available *(placeholder; product owner sets)* |
| **Reporter** | (filled by whoever pastes) |
| **Assignee** | (mobile lead) |
| **Dependencies** | `docs/PARAMETERS.md` exists at this commit. Spec must not change underneath the implementer. |
| **Fix Version** | v1 — Android alpha |

---

## User Story

> **As a** self-learner power user
> **I want** to adjust the seven preset parameters, reset them with one click, and add my own custom key:value parameters when Power Mode is on
> **so that** I can tune the lesson to my exact taste — pedagogy, tone, citation style — without the product collapsing into free-form chat.

---

## Background

The seven scoped-query parameters and the override UX are specified in `docs/PARAMETERS.md`:
- Seven parameters: P1 Topic, P2 Level, P3 Language, P4 Prior knowledge, P5 Format, P6 Real-world framing, P7 Depth.
- Three override modes: **Adjust** (every user, side panel), **Reset** (every user, single button), **Add** (Power Mode only, key:value list).
- Custom parameters are passed to the prompt-builder as a structured `extensions: {key:value}` block — never as free-form chat appended to the user message.

Layout is locked to D16 — single canvas + collapsible side panel. No wizard.

---

## Acceptance Criteria (Gherkin)

### AC1 — Side panel exposes all 7 parameters

```
Given a fresh user is on the Query screen
When they tap the side-panel chevron
Then they see, in order:
  - Level (dropdown)
  - Language (picker)
  - Prior knowledge (textarea, optional)
  - Format (picker, 3 options at MVP — Lesson / Explanation / Quiz)
  - Real-world framing (textarea, optional)
  - Depth (dropdown)
And Topic is on the canvas, not the side panel.
```

### AC2 — Adjust mode

```
Given the side panel is open
When the user changes any preset (e.g., Level from Standard to Expert)
Then the new value is reflected in the side panel
And tapping Generate sends the new value to the backend.
```

### AC3 — Reset mode

```
Given the user has changed presets and typed into Prior knowledge and Real-world framing
When they tap "Reset to defaults"
Then P2/P3/P5/P7 return to their defaults
And P4 and P6 textareas are cleared
And P1 (Topic) is NOT cleared (Reset is for parameters, not the question itself).
```

### AC4 — Power Mode toggle

```
Given Power Mode is OFF (default)
Then the "Advanced parameters" section is NOT visible in the side panel.

Given the user enables Power Mode in Settings
When they return to the Query screen and open the side panel
Then the "Advanced parameters" section appears at the bottom of the side panel.
```

### AC5 — Add custom parameter

```
Given Power Mode is ON
When the user adds a key "tone" with value "socratic"
Then the row is saved
And the request payload to /generate contains an `extensions` block: `{ "tone": "socratic" }`
And the prompt-builder includes a labelled bullet "tone: socratic" in the system prompt.
```

### AC6 — Validation rules

```
Given the user is adding a custom parameter
When the key contains uppercase, spaces, or non-ASCII chars
Then an inline error appears: "Key must match a-z, 0-9, _ — start with a letter"
And the row cannot be saved.

When the key is one of the reserved core IDs (topic / level / language / prior_knowledge / format / framing / depth)
Then an inline error appears: "Reserved name — adjust the core parameter instead"
And the row cannot be saved.

When the value exceeds 200 chars or contains a newline
Then an inline error appears.
```

### AC7 — Quantity cap

```
Given Power Mode is ON
When the user has added 5 custom parameters
Then the "Add another" button is disabled with tooltip "5 max at MVP".
```

### AC8 — Persistence

```
Given the user generated a lesson with a set of custom parameters
When they open the Library and tap "Re-run with same parameters"
Then the side-panel state (including custom params and Power Mode visibility) is restored exactly.
```

### AC9 — No free-form chat path

```
Given a custom parameter is set
When the request is built and sent
Then no part of the custom-param value is concatenated into the Topic field
And no part of the custom-param value is sent as a literal `messages: [{ role: "user", content: "..." }]` extension
(Custom params travel inside the structured extensions block only.)
```

### AC10 — Format inconsistency surfaced

```
Given the developer is implementing the Format picker
Then the picker shows exactly the three formats locked by D13 (Lesson / Explanation / Quiz)
And does NOT show Cheatsheet or Worked example
(SCOPE.md §7.2's five-option list is treated as v1.1+ candidates.)
```

---

## Edge cases & explicit non-goals

**Edge cases the implementer must handle:**

- Empty Topic + Generate tapped → inline error "Topic is required", request not sent.
- Prior knowledge / Real-world framing > 2000 chars → soft warning at 1800, hard cap at 2000 (mobile keyboard often pastes long content).
- Power Mode toggled OFF while a query has 3 custom params loaded → params persist in state but are hidden; toggling back ON shows them; sending Generate while OFF strips them from the request payload.
- Slow network during Generate → loading state on the Generate button; D2 covers async push so the screen does not block.
- User edits a saved-lesson's parameters and re-runs → counts as a fresh `/generate` call (no idempotency at MVP, per CLAUDE.md pipeline rules).

**Explicit non-goals (Out of Scope):**

- Adding new core parameters (P8+) — separate ticket.
- Adding new Format options (Cheatsheet, Worked example) — separate ticket per recommended resolution in PARAMETERS.md §3.P5.
- Backend changes to validate custom-param keys — backend treats `extensions` as opaque map at this ticket's scope; validation lives client-side.
- A telemetry pipeline (see Telemetry below — instrumentation hooks ship in this ticket; the dashboard does not).
- iOS support (Android-first per D3).

---

## Definition of Done

- [ ] Acceptance criteria AC1–AC10 pass on a real Android device in dev build.
- [ ] Unit tests for custom-param validation (AC6) — Jest, ≥ 95% coverage of the validator.
- [ ] Component tests for the side panel — Adjust, Reset, Power-Mode-on, custom-param add/remove flows.
- [ ] One end-to-end manual test on a real device: BYOK key entered → new query with 2 custom params → push received → lesson rendered → re-run from Library restores params.
- [ ] No regression of D16 layout (single canvas + collapsible side panel; no wizard).
- [ ] PR cross-references `docs/PARAMETERS.md` as the spec.
- [ ] Spec inconsistency in P5 / Format is resolved before merge — i.e., the Format picker's option list is unambiguous in code.
- [ ] **Non-goal locked:** does NOT enable free-form chat — overrides remain inside the scoped-query model. Reviewer should explicitly check AC9 in PR.

---

## Telemetry (instrumentation only)

Instrument these events; the dashboard is a separate ticket.

| Event | When fired | Properties |
|-------|------------|------------|
| `query.params.adjust` | A non-default preset is sent | which params were non-default |
| `query.params.reset` | Reset button tapped | how many params had been changed |
| `query.params.power_mode_enabled` | Power Mode toggled ON in Settings | — |
| `query.params.custom_added` | A custom param row is saved | key (slug only — never the value), key length |
| `query.params.custom_count` | At Generate time | count of custom params in payload (0..5) |

Goal of telemetry (read by the next ticket's analytics work): identify the top-3 most-used custom keys over a month → candidates for promotion to core parameters per PARAMETERS.md §6.

---

## Links

- Spec: `docs/PARAMETERS.md`
- Scope source: `SCOPE.md` §7.2
- Locked decisions: `CLAUDE.md` D9, D13, D15, D16
- Security: `docs/adr/ADR-001-byok-security-model.md`

---

## Sub-tasks (suggested split)

1. SBQ-UI-001a — Side-panel scaffold + AC1 (1 pt)
2. SBQ-UI-001b — Adjust + Reset (1 pt)
3. SBQ-UI-001c — Settings Power Mode toggle + AC4 visibility (0.5 pt)
4. SBQ-UI-001d — Custom-param row component + validator + AC5/AC6/AC7 (1.5 pt)
5. SBQ-UI-001e — Persistence + Library re-run integration (AC8) (0.5 pt)
6. SBQ-UI-001f — Telemetry hooks (0.5 pt)
