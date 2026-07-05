# Proposal: A Reusable Help System (cross-product)

**Status:** Draft / base proposal — 2026-07-05
**Author:** Siva Mambakkam (with Claude)
**Scope:** A shared, portable "Help System" capability. Piloted in Mentible, designed to carry to StudyBuddy_OnDemand, Pramana, and future products.
**Trigger:** Help is currently ad-hoc and drifts — the just-shipped *draft sharing* feature has **no in-app Help entry**, and there is **no process** ensuring Help keeps pace with features.

---

## 1. Problem

Today, help/documentation across our products is:

- **Ad-hoc & drift-prone.** In Mentible, `helpContent.ts` covers getting-started, keys, reading, formats, troubleshooting, glossary — but new features (sharing) ship without a matching topic. Nothing catches the gap.
- **Bespoke per product.** Each app re-implements its own help surfaces (Help tab, contextual hints, onboarding tour, provider guides). No reuse across Mentible / OnDemand / Pramana.
- **Single-surface & static.** Help is mostly a static tab; it isn't consistently surfaced *in context* (at the control the user is looking at), and there's no path to a public/searchable help site or to in-product search.
- **No "definition of done."** Shipping a user-facing feature doesn't require updating help, so coverage decays.

**Exhibit A:** a user asked *"do we have a task to keep help docs updated?"* — the honest answer was *no*, and the sharing feature proved it.

## 2. Vision

A **single Help System capability** — content model + delivery components + freshness process — that any of our products adopts the way they adopted **wegofwd-llm** (LLM seam) and **wegofwd-secure** (key handling): a versioned shared package plus per-product content.

> **`wegofwd-help`** (working name): the *engine* (schema, renderer components, search, hint hooks, coverage tooling). Each product ships its own **content pack** (its topics) against that engine.

Principle: **the system is shared; the content is per-product.** Just like the LLM package is provider-agnostic and each product brings its keys.

## 3. Principles

1. **One source of truth per topic.** A help topic is authored once (structured data), then rendered to *every* surface — Help tab, contextual hint, tooltip, onboarding step, public help site. No copy-paste across surfaces.
2. **Context over catalog.** Help meets the user at the control (a `?` next to *Share draft*), not only in a separate tab they have to hunt through.
3. **Coverage is enforced, not remembered.** A feature is not "done" until its help topic exists; CI/checklist catches gaps.
4. **Portable by default.** Product-agnostic engine; content is data, not code, so it travels and can be localized.
5. **Progressive depth.** One-line hint → short topic → full guide → (later) searchable site. The reader picks the depth.
6. **Author-friendly.** Non-engineers can write/edit content (structured markdown/data), ideally without a deploy.

## 4. Architecture

### 4.1 Content model (the core)
A **Topic** is structured data (not free HTML), so it renders consistently everywhere and stays queryable:

```
Topic {
  id            // stable slug, e.g. "share-a-draft"
  title
  summary       // 1–2 lines — powers hints/tooltips
  audience[]    // e.g. ["author"], ["reviewer"] — enables role-scoped help
  surfaces[]    // where it may appear: tab, hint, tour, tooltip, site
  body[]        // ordered blocks: paragraph | steps | callout | image | link
  relatedIds[]  // cross-links
  featureKey    // links the topic to a product feature (for coverage checks)
  updatedAt / version
}
```
Mentible's `helpContent.ts` is already ~80% of this — this formalizes + extends it (audience, surfaces, featureKey, coverage).

### 4.2 Delivery surfaces (all render the same Topic)
| Surface | What it is | Status in Mentible |
|---|---|---|
| **Help tab** | Browsable list of topics | ✅ exists (`help.tsx`) |
| **Contextual hint** | A `?`/inline hint at a control → the topic's summary + link | ✅ partial (`HelpButton`, `HelpHint`, SBQ-UI-003) |
| **Onboarding tour** | Guided first-run steps | ✅ exists (`onboarding/`) |
| **Tooltip / peek** | Hover/press summary | ➕ new |
| **Public help site** | SEO-able, shareable, searchable web docs generated from the same Topics | ➕ new (later) |
| **In-app search** | Find a topic by keyword | ➕ new (later) |

### 4.3 Authoring & source of truth
- Topics live as **data** (typed TS/JSON/MDX) in each product's content pack, reviewed in PRs (v1).
- **Later:** a lightweight authoring path (a hosted content store or a docs repo) so non-engineers edit without a deploy — mirrors the "hosted content" thinking from ADR-027, but for help.

### 4.4 Freshness & coverage (the part that fixes the trigger)
- **`featureKey` registry:** each user-facing feature declares a key; each Topic references one.
- **Coverage check (CI):** a test/script asserts every registered feature has ≥1 Topic (and flags Topics with no feature). Ships red if a feature has no help — makes help part of *done*.
- **Staleness signal:** Topic `updatedAt` vs. the feature's last change; a periodic audit (scheduled agent) flags topics older than their feature.
- **Definition of Done:** "user-facing feature → add/update its Topic" added to `CLAUDE.md` and PR template.

### 4.5 Cross-product portability
- **`wegofwd-help` package:** schema + renderer components (React Native + web) + hint hooks + search + coverage tooling. Versioned & pinned like `wegofwd-llm`/`wegofwd-secure` (ADR-012/019 pattern).
- Each product depends on it and ships its own `help-content/` pack.
- Shared engine → one place to improve search, a11y, theming, the public-site generator; every product benefits.

## 5. Phased rollout

- **Phase 0 — Stop the bleed (now):** add the **"Share a draft" Topic** to Mentible; add the DoD line to `CLAUDE.md` + PR template. (Hours.)
- **Phase 1 — Formalize the model in Mentible:** extend `helpContent.ts` to the Topic schema (audience/surfaces/featureKey); wire the coverage CI check. Prove it in one product. (Days.)
- **Phase 2 — Extract `wegofwd-help`:** pull the engine into a shared package; Mentible consumes it (thin shims, no behavior change) — same playbook as wegofwd-secure. (Days–1 wk.)
- **Phase 3 — Adopt in a 2nd product:** OnDemand or Pramana pulls the package + writes its content pack. Validates portability. (Days.)
- **Phase 4 — Public help site + search:** generate an SEO/searchable site from the Topics; add in-app search. (Later, demand-driven.)

## 6. Success criteria
- 100% of user-facing features have a Topic (coverage check green).
- New feature → help ships in the *same* PR (DoD enforced).
- ≥2 products share one help engine, each with its own content.
- Time-to-document a feature drops (author writes one Topic, appears on all surfaces).

## 7. Open decisions
1. **Content format:** typed TS objects (today) vs. MDX vs. a hosted content store — trade authoring ease vs. deploy-free editing.
2. **Coverage strictness:** hard CI fail vs. warn-only at first.
3. **Package boundary:** does `wegofwd-help` own onboarding-tour too, or just topics + hints + search?
4. **Public site:** build now (growth/SEO lever, ties to the Open-Library growth theme) or defer.
5. **Localization:** design the schema for i18n now (en/fr/es per the product scope) or later.
6. **Naming/ownership:** `wegofwd-help` vs. folding into an existing shared package.

## 8. Relationship to existing work
- Follows the **shared-package strategy** (ADR-012 `wegofwd-llm`, ADR-019 `wegofwd-secure`) — help becomes the next platform capability.
- Builds on Mentible's existing help primitives (`helpContent.ts`, `HelpButton`/`HelpHint` SBQ-UI-003, onboarding wizard, provider guides) — an evolution, not a rewrite.
- A public help site aligns with the **growth/Open-Library** direction (registration-gated reading, discovery).

---

*Base draft for discussion — Section 7 lists the calls to make. Next concrete step regardless of the big decisions: Phase 0 (add the sharing Topic + the DoD line).*
