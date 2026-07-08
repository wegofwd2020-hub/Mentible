<p align="center">
  <img src="mobile/assets/brand/mentible-lockup-redorange-white.png" alt="Mentible — Author Yourself" width="360">
</p>

# Mentible (repo `StudyBuddy_SelfLearner`)

> **A purpose-built LLM client for self-learners** — turn a scoped query into a real,
> polished **book** (EPUB3/PDF). *("StudyBuddy Q / Q = Query" is the historical name;
> the public brand is **Mentible** — ADR-006, pending trademark clearance.)*

Repo: `StudyBuddy_SelfLearner` (internal name). Brand: **Mentible** (public-facing).

> **Status (2026-06-27): in production.** Backend live at `mambakkam.net/mentible-api`;
> full web app at `mambakkam.net/app/mentible`; read-only demo at `/demos/mentible`;
> Android APK released. Accounts (Supabase) + super-admin verified live.
> **Current "what's built" record → [`docs/STATUS.md`](docs/STATUS.md).**

---

## What is this?

A focused, opinionated mobile client on top of the Anthropic API. Adults paste
their own Anthropic API key (BYOK), describe what they want to learn, and get
a beautifully rendered lesson, explanation, or quiz back.

Not a chatbot. Not a course platform. Not a children's product.

Think *"Claude Code, but for learners instead of coders."*

---

## Status

✅ **In production (2026-06-27).** Backend (FastAPI: generate / export / accounts /
super-admin) live at `mambakkam.net/mentible-api`; Expo app (Books-only authoring,
reader, BYOK, Supabase accounts) shipped as a **hosted web app** (`/app/mentible`), a
read-only **demo** (`/demos/mentible`), and an **Android APK**; Node EPUB3/PDF compiler;
Content Trust Manifest. Google sign-in + super-admin verified live. **Full current
record → [`docs/STATUS.md`](docs/STATUS.md).**

| Doc | Purpose |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Durable spec — repo conventions, layer rules, pitfalls |
| [`SCOPE.md`](./SCOPE.md) | Full scope decisions and the reasoning behind each |
| [`docs/MVP_v1.md`](./docs/MVP_v1.md) | What the first usable slice looks like |
| [`docs/adr/`](./docs/adr/) | Architecture Decision Records |

Start with `SCOPE.md` if you want context. Read `CLAUDE.md` if you're about to
write code (you aren't yet — the codebase is empty).

---

## Quick links

- Mobile (RN + Expo) → [`mobile/`](./mobile/)
- Backend (FastAPI) → [`backend/`](./backend/)
- Vendored pipeline → [`pipeline/`](./pipeline/)
- ADRs → [`docs/adr/`](./docs/adr/)

---

## Key constraints (read these before any code lands)

1. **BYOK** — User pays Anthropic directly. We never store keys.
   See [`docs/adr/ADR-001-byok-security-model.md`](./docs/adr/ADR-001-byok-security-model.md).
2. **Vendored pipeline only** — Never import from `../StudyBuddy_OnDemand/`.
   See [`docs/adr/ADR-002-repo-structure-and-vendoring.md`](./docs/adr/ADR-002-repo-structure-and-vendoring.md).
3. **Adults only** — No COPPA, no FERPA, no school logic.
4. **Quality over scale** — This is a demo of the IP, not a mass-market consumer play.

---

## Sister project

[`StudyBuddy_OnDemand`](../StudyBuddy_OnDemand/) — the institutional B2B product
for schools. Different audience, different compliance, different infra. Shares
prompt IP via vendoring (one-way), nothing else.
