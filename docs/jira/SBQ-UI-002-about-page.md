# SBQ-UI-002 — About page (Author Information + Ethics boundaries)

> **Note:** This file is a paste-ready ticket body. Created as a GitHub Issue in `wegofwd2020-hub/StudyBuddy_SelfLearner`.

---

## JIRA fields

| Field | Value |
|-------|-------|
| **Project** | StudyBuddy Q (SBQ) |
| **Issue Type** | Story |
| **Summary** | About page — surface Author Information and current ethics boundaries inside the app |
| **Component** | mobile / Settings + About screen |
| **Labels** | `enhancement`, `settings`, `about-page`, `mvp` |
| **Epic Link** | (set when "Settings & Account" epic exists) |
| **Priority** | Medium *(supports M4 — AUP discoverability — from `PARAMETERS.md` §5.3)* |
| **Estimate** | 3 story points *(static-content screen + content-sync wiring; no backend changes)* |
| **Sprint** | next available |
| **Reporter** | (filled by whoever pastes) |
| **Assignee** | (mobile lead) |
| **Dependencies** | Soft-depends on AUP draft existing (link target). The Ethics summary content file (M-row text) must be approved by product owner before alpha. |
| **Fix Version** | v1 — Android alpha |

---

## User Story

> **As a** self-learner using StudyBuddy Q
> **I want** to find — inside the app — who built it and what its ethics boundaries are
> **so that** I can verify the product is operated responsibly and know what content / behaviour is in or out of bounds before I rely on the lessons it generates.

---

## Background

The About page is the canonical in-app surface for two distinct classes of information:

1. **Author Information** — who built and operates this product (name, contact, brand link, optional credit list).
2. **Ethics boundaries** — a user-facing summary of `docs/PARAMETERS.md` §5 (safety boundaries on the override system): the prohibited content categories, what data is and isn't stored, the moderation pass, the AUP, the 18+ self-attestation, and the BYOK posture.

This screen also discharges defense **M4** in `PARAMETERS.md` §5.3 — "Acceptable Use Policy + clickwrap at sign-up. Educational framing only; explicit prohibitions; basis for account termination. Permanent one-line summary on the Query canvas footer." The footer link points here.

The ethics text is **not** invented for the About page. It is sourced from a single content file that mirrors §5; the About page is the rendering surface, not the authoring surface. This keeps engineering (PARAMETERS.md §5) and user-facing copy (ethics-content file) in lockstep without duplication.

---

## Acceptance Criteria (Gherkin)

### AC1 — Settings entry-point

```
Given the user is on Settings
Then they see an "About" row near the bottom of the screen
And tapping it opens the About page.
```

### AC2 — Author Information section

```
Given the user is on the About page
Then they see an "Author" section containing:
  - The author's display name
  - A short one-paragraph bio
  - An optional contact / website link
  - An optional credits list (open-source acknowledgments, advisors, etc.)
And the content is sourced from a content file (not hard-coded as constants).
```

### AC3 — Ethics & Safety section

```
Given the user is on the About page
Then they see an "Ethics & Safety" section that summarises (in user-friendly language):
  - The five MVP defenses M1–M5 from PARAMETERS.md §5.3:
      - M1: We use a curated list of allowed customisation options
      - M2: We screen prompts for harmful content before generating
      - M3: We block injection-style values
      - M4: Use of this app is governed by an Acceptable Use Policy
      - M5: We log shares and abuse signals — never your prompts, lessons, or API key
  - The named prohibited content categories (weapons synthesis, illicit drug synthesis, self-harm instruction, content sexualising minors, malware authoring beyond conceptual)
  - Adult-only product disclosure (18+ self-attestation)
  - BYOK statement: "Your Anthropic API key is yours. We never log it, store it, or display it (settings shows last-4 only)."
And every item links to its source of truth (AUP, PARAMETERS.md, ADR-001 where appropriate).
```

### AC4 — App info section

```
Given the user is on the About page
Then they see an "App info" section containing:
  - App name and tagline
  - Version (e.g., 1.0.3)
  - Build number (e.g., 142)
  - Environment (production / staging — hidden in production unless overridden)
  - Open-source licenses link (renders the standard licenses screen)
```

### AC5 — AUP + 18+ attestation

```
Given the user is on the About page
Then the "Ethics & Safety" section includes a prominent link "Read the full Acceptable Use Policy"
And a one-line note: "This product is for users 18+ only. By using it you confirm you are at least 18."
(The actual sign-up clickwrap is a separate flow; this is the in-app discoverability surface for it.)
```

### AC6 — Single source of truth for ethics text

```
Given a future change to PARAMETERS.md §5 (e.g., a new defense M6 added)
When the corresponding ethics content file is updated
Then the About page reflects the new content on next app launch
(without code changes — content is data, not constants).
```

---

## Edge cases

- **Offline** — App info renders from local manifest; Author and Ethics sections render from bundled content (no network required).
- **Missing version metadata** — Display "—" rather than crashing or showing "undefined".
- **Long content** — Sections scroll; no truncation. Long bios still render in full.
- **Stale content file** — If the bundled ethics content is older than PARAMETERS.md §5 by N days (TBD), surface a non-blocking dev-build banner: "Ethics content out of date — rebuild required."
- **Right-to-left languages** — At MVP we ship English only; layout uses logical (start/end) padding so RTL ships clean later.

---

## Definition of Done

- [ ] AC1–AC6 pass on a real Android device in dev build
- [ ] Ethics content file is structurally derived from `docs/PARAMETERS.md` §5 (a build-time check verifies the M1–M5 names match)
- [ ] AUP link target is decided (interim: a placeholder `/aup` URL on our domain) — actual AUP content can be a separate ticket
- [ ] No duplication: the M1–M5 defense names appear in exactly one user-facing source — the ethics content file, NOT inline in component code
- [ ] Component tests for each section's rendering
- [ ] One end-to-end manual test on a real device: Settings → About → scroll through all sections → tap each link
- [ ] Layout uses logical padding (RTL-ready) even though only en ships
- [ ] PR cross-references this spec file and PARAMETERS.md §5

---

## Out of Scope

- Writing the actual AUP content (separate content/legal task)
- Multi-language About page content (en only at MVP per D-language)
- User-editable About content (not a feature)
- Live-fetched ethics content from a remote endpoint (bundled at build time at MVP — refresh requires app update)
- Telemetry-based personalisation of which ethics items to show (everyone sees the same content)
- iOS layout pass (Android-first per D3)
- Author photo / multimedia (text + simple link list at MVP)
- "Powered by" carousel / sponsor logos

---

## Telemetry

| Event | When fired | Properties |
|-------|------------|------------|
| `about.opened` | User opens About page | source: settings \| query_footer \| onboarding |
| `about.ethics_section_expanded` | User expands the Ethics & Safety section | — |
| `about.aup_link_tapped` | User taps the AUP link | — |
| `about.author_link_tapped` | User taps the Author contact / website link | which_link: contact \| website \| credits |
| `about.licenses_opened` | User taps the licenses link | — |

---

## Cross-references

- **Source of truth for ethics content:** `docs/PARAMETERS.md` §5 (Safety boundaries on the override system). The About page is a rendering surface, not the spec.
- **Discharges:** `PARAMETERS.md` §5.3 — defense **M4** ("Acceptable Use Policy + clickwrap at sign-up. Permanent one-line summary on the Query canvas footer."). The footer link points to this About page.
- **Related:** ADR-001 (BYOK security model) — informs the BYOK statement in AC3.
- **Adult-only attestation:** consistent with `CLAUDE.md` "Compliance" section.
- **Related issue:** #5 (SBQ-UI-001 parameter overrides) — the override UI surface is the *user-facing analogue* of the spec the About page summarises.

---

## Sub-tasks (suggested split)

1. SBQ-UI-002a — Settings entry + navigation (0.5 pt)
2. SBQ-UI-002b — Ethics-content file format + bundling (0.5 pt)
3. SBQ-UI-002c — About page layout + sections (1 pt)
4. SBQ-UI-002d — Build-time check that ethics file mirrors PARAMETERS.md §5 (0.5 pt)
5. SBQ-UI-002e — Telemetry hooks (0.5 pt)
