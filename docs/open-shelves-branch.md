# `feat/open-shelves` — long-lived integration branch (LOCALHOST ONLY)

> **This file lives only on `feat/open-shelves`.** It is the working agreement for the
> Open Shelves feature-sequence branch. Delete it in the squash/merge when the branch
> finally lands on `main`.

## Purpose

A single long-lived branch for the **sequentially dependent** Open Shelves feature stack,
kept **separate from `main`** so an issue on `main` never entangles this work (and vice
versa). All four ADRs build in order on this one branch:

1. **ADR-028** — Open Shelves (OPDS feed catalog client; device-local, direct-from-source
   downloads). ← the foundation; everything else depends on it.
2. **ADR-029** — Library-grounded references / RAG (device-local free-tier mode first).
3. **ADR-030** — Content currency agent (author-side BYOK check).
4. **ADR-032** — Server-hosted library + hosted RAG (the paid hosted tier) — only the
   parts that don't need the managed-billing launch; hosted is gated (ADR-032 D9).

Companion specs: `docs/specs/open-shelves-spec.md`, `docs/adr/ADR-028…032`.

## Rules for this branch

- **LOCALHOST ONLY. Do NOT deploy this branch to the VPS.**
- **Structural guarantee:** `scripts/deploy/web-deploy.sh` always builds from
  **`origin/main`** (hardcoded, line ~64 `git worktree add --detach … origin/main`) — it
  **cannot** build a feature branch. So this branch is un-deployable **by construction**;
  the *only* way any of it reaches the VPS is a deliberate merge to `main`.
- **Therefore: do not merge to `main` until the sequence is stable and reviewed.** Keeping
  it off `main` is the whole safeguard.
- Backend prod (`/opt/mentible` on the VPS) tracks `main` too — same guarantee.

## Local dev loop (how to run this branch)

```bash
# Backend (FastAPI) — local
cd backend && uvicorn main:app --reload         # http://localhost:8000

# Mobile / web app — local, pointed at the local backend
cd mobile && npx expo start --web               # or --android
# set the app's API base to http://localhost:8000 for local testing
```

No `web-deploy.sh`, no VPS, no `/opt/mentible` swap while on this branch.

## Landing (later, when stable)

When the stack is proven locally and reviewed, land it as a **normal PR to `main`** (which
is what makes it deployable). Delete this file in that merge.
