# MVP v1 — First Usable Slice

> The minimum scope to prove the BYOK end-to-end loop works on a real device
> against the real Anthropic API. Everything else from `SCOPE.md` is **v1.1+**.
>
> **Last updated:** 2026-04-25

---

## North star

A self-learner can:

1. Install **StudyBuddy Q** on Android
2. Paste their Anthropic API key into Settings (key stored in `expo-secure-store`)
3. Type a topic on the home screen, pick a Level
4. Tap Generate
5. See a beautifully rendered **Lesson** appear ~30–90 s later, with KaTeX maths and Mermaid diagrams rendered properly
6. Re-open the app and see that lesson cached locally on the device

That's it. That's MVP.

---

## In scope (MVP only)

| Layer | What |
|---|---|
| Mobile | Settings screen with API key entry · Home screen with Topic input + Level dropdown + Format=Lesson (locked) · Generate button · Lesson view |
| Backend | `POST /generate` (key passthrough) → returns `job_id` · `GET /jobs/{id}` polling endpoint |
| Pipeline | `AnthropicProvider` + `prompts.py` (vendored from StudyBuddy_OnDemand) |
| Rendering | KaTeX (math) + Mermaid (diagrams) + GFM tables + attributed blockquotes |
| Persistence | Local-only on device (`AsyncStorage` or `expo-sqlite`). **No cloud library** |
| Auth | None — single-user, single-device |

---

## Out of scope (deferred to v1.1+)

| Feature | Why deferred |
|---|---|
| Auth (email + Google) | MVP is single-user; auth becomes critical only when sync arrives |
| Cloud sync | Requires accounts; tackled in v1.1 |
| FCM push | Polling is fine for an MVP; push is v1.1 polish |
| Quiz format | v1 stretch; MVP needs only Lesson |
| Explanation format | Same |
| French / Spanish | MVP is English-only |
| Prior knowledge / Framing inputs | Side-panel optional fields; MVP keeps form to Topic + Level |
| Library list / search | MVP stores last lesson only; full library is v1.1 |
| iOS | Android-first per D8 |
| "AI picks the right visual" prompt step | MVP keeps prompts simple |
| Settings polish (profile, theme, dyslexia mode) | Bare minimum settings only |

---

## Success criteria

| # | Criterion | How verified |
|---|---|---|
| 1 | User enters key once, never re-enters | `expo-secure-store` round-trip test |
| 2 | Topic + Level → rendered lesson works on real device | Manual end-to-end test on a Pixel emulator + one physical Android |
| 3 | Maths rendering visible | Topic *"Quadratic formula"* — KaTeX must render `$ax^2 + bx + c = 0$` correctly |
| 4 | Diagram rendering visible | Topic *"TCP three-way handshake"* — Mermaid sequence diagram must render |
| 5 | Backend never logs the key | `grep -i "sk-ant" backend/logs/` returns 0 results after 100 generations |
| 6 | Generation completes in < 90 s p95 | Logged job-duration histogram |

When all six pass, **MVP is done**. Move to v1.1.

---

## End-to-end flow

```
Mobile                          Backend                      Anthropic
  │                                │                             │
  ├─[Settings] save key ───────────│                             │
  │      to expo-secure-store      │                             │
  │                                │                             │
  ├─[Home] topic + Level ──────────│                             │
  ├─ POST /generate ───────────────►                             │
  │   Body: {topic, level,         │                             │
  │     format: "lesson",          │                             │
  │     api_key: <key>}            │                             │
  │                                ├─ encrypt key (per-job),     │
  │                                │   store in Redis TTL=120s   │
  │                                ├─ enqueue Celery job         │
  ◄──── 202 {job_id} ───────────────┤                            │
  │                                │                             │
  ├─ poll GET /jobs/{id}           │                             │
  │  (every 3 s)                   │                             │
  │                                ├─ worker fetches key,        │
  │                                │   calls Anthropic ──────────►
  │                                │                             │
  │                                ◄──── lesson JSON ─────────────┤
  │                                ├─ shred key, save lesson     │
  │                                │                             │
  ◄──── 200 {status: done,         ┤                             │
  │       lesson: {...}}           │                             │
  │                                │                             │
  ├─[Render] Markdown +            │                             │
  │   KaTeX + Mermaid              │                             │
  │                                │                             │
  ├─ store lesson locally          │                             │
  │  (AsyncStorage)                │                             │
```

---

## What's intentionally fragile in MVP

These gaps are **by design** — they belong to v1.1+, not MVP:

- No retry on Anthropic timeout — let it fail, surface the error
- No queue depth limit — we trust low traffic during the demo phase
- ~~No rate limiting on API endpoints~~ — **added** (`core/rate_limit.py`): a
  fixed-window per-identity (auth sub / IP) limiter on `/generate`, `/structure`,
  `/export`; an abuse guard + cost-control lever for managed token spend (ADR-005)
- No analytics or telemetry beyond basic `structlog`
- No accounts or multi-device sync — each install is its own world
- No graceful key-rotation flow — the user re-pastes if their key changes
- No usage display ("you've spent $X with Anthropic this month") — out of scope; user sees that on console.anthropic.com

---

## When MVP is done — what triggers v1.1

Once the six success criteria all pass on a real device with a real key, we move to **v1.1**:

| v1.1 ticket | Builds on MVP by adding |
|---|---|
| Auth — email + Google | Sign-in flow before Generate |
| Cloud sync — library | Per-account lesson library across devices |
| FCM push | Replaces polling |
| Quiz output format | Second format added to selector |
| Explanation output format | Third format |
| French + Spanish | Language picker becomes meaningful |

v1.1 → public alpha (after trademark check).
