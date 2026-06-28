# Deployment pipeline — local → demo → production

**Policy:** every feature is verified at each stage before advancing. Nothing goes
straight to production.

```
  ┌─────────┐   verify    ┌──────────┐   verify    ┌────────────┐
  │  LOCAL  │ ──────────► │   DEMO   │ ──────────► │ PRODUCTION │
  │ dev box │  + merge    │ public   │             │ public     │
  └─────────┘  to main    └──────────┘             └────────────┘
```

`main` is the single source of truth: **demo and production both build from
`origin/main`, never from a working tree** (a stale working tree once shipped a
build missing a merged feature — don't repeat it).

| Stage | Web surface | Backend | Demo flag | baseUrl |
|---|---|---|---|---|
| **Local** | `expo start --web` (`:8081`) | local docker (`:8001`) | off | — (dev server) |
| **Demo** | `mambakkam.net/demos/mentible/` | prod `/mentible-api` | **on** (read-only) | `/demos/mentible` |
| **Production** | `mambakkam.net/app/mentible/` | prod `/mentible-api` | off | `/app/mentible` |

---

## Stage 1 — LOCAL (develop + verify, then merge to `main`)

Work on a feature branch.

```bash
./dev_start.sh up            # backend (:8001) + redis via docker
cd mobile && EXPO_PUBLIC_API_BASE_URL=http://localhost:8001 npx expo start --web --port 8081
```

**Gate (must pass before advancing):**
```bash
cd mobile && npx tsc --noEmit && npx eslint . && npx jest
```
+ a manual smoke of the feature on `:8081`.

Then **PR → CI green → merge to `main`.** Demo/prod deploys build from `main`, so
the feature must be merged before Stage 2.

> Backend-only change? There is no separate "demo backend" — the demo web uses the
> prod backend (gated by demo mode). Verify the backend locally here, then refresh
> the prod backend (Stage 3 backend track below).

## Stage 2 — DEMO (public read-only preview)

```bash
scripts/deploy/web-deploy.sh demo
```
Builds `EXPO_PUBLIC_DEMO_MODE=1` from `origin/main`, publishes to
`mambakkam-net/public/demos/mentible/`, pushes (auto-deploys), and verifies
`https://mambakkam.net/demos/mentible/` returns 200.

**Gate:** smoke the feature at `/demos/mentible/`. The demo gates
generate/author/sign-in, so this stage validates UI + read paths; auth/generate
paths are validated locally (Stage 1) and in production (Stage 3).

## Stage 3 — PRODUCTION (full app)

```bash
scripts/deploy/web-deploy.sh app
```
Builds the full app (demo off) from `origin/main`, publishes to
`mambakkam-net/public/app/mentible/`, deploys, verifies
`https://mambakkam.net/app/mentible/` returns 200.

**One-time per environment:** Google sign-in needs the app origin allowlisted in
**Supabase → Authentication → URL Configuration → Redirect URLs**
(`https://mambakkam.net/app/mentible/`). Email/password works without it.

### Production backend (only when backend code changed)

The prod backend at `/opt/mentible` is **root-owned and not a git repo**, so a
refresh is a root operation (the `deploy` user can `docker compose` but can't
write the source). Ship + run the root runbook:

```bash
# ship current main to the VPS (as the deploy user):
git archive --format=tar.gz -o /tmp/mentible-main.tgz origin/main
scp -i ~/.ssh/mambakkam_deploy /tmp/mentible-main.tgz deploy@178.105.160.62:/tmp/
# then run the ROOT block in Plans/PROD_BACKEND_REFRESH_TO_MAIN.md (swap + --no-cache build + migrate + verify)
```

---

## The three traps the script prevents (don't bypass them)

1. **Build from `origin/main`, not your working tree.** `web-deploy.sh` does this
   in a disposable worktree. A stale checkout once shipped a build missing a merged
   feature.
2. **Force-add the export.** `.gitignore`'s `node_modules/` rule silently drops the
   ~70 fonts under `public/<path>/assets/node_modules/...`. The script `git add -f`s
   and asserts ~87 files staged. Missing fonts → 404s + blank/broken text live.
3. **Export with `--clear`.** Without it, an export reuses a stale metro asset cache
   from a prior build with different env (e.g. an app build right before a demo
   build) and silently drops assets — the demo once shipped 21 files with **0 of its
   55 fonts**. The script always passes `--clear`.

Other notes:
- **Same-origin backend** (`mambakkam.net` → `/mentible-api`) — no CORS.
- **Cloudflare** is `DYNAMIC` on pages (no purge needed); a 404 probed *before* a
  fix can be briefly cached, but self-heals (`cf-cache-status: EXPIRED`).
- `experiments.baseUrl` in `mobile/app.json` is a single static value shared by both
  builds — the script flips it per build in the worktree. (A future cleanup could
  make it env-driven so no flip is needed.)

## Other artifacts (separate tracks)
- **Android APK:** local gradle release build → GitHub Release on the **public**
  mambakkam-net repo; landing page links `releases/latest/download/Mentible.apk`.
  See the release notes / `eas.json`.

## Domains / DNS

The live product is served **entirely under `mambakkam.net`** (see the surface
table above). There is **no production traffic on a standalone Mentible domain** —
keep this in mind before treating `mentible.com` as canonical.

- **`mentible.com`** — registered via **Loopia** (`ns1/ns2.loopia.se`) and wired to
  a **Firebase Hosting** site:
  - apex `mentible.com` → A `199.36.158.100` (Firebase)
  - `www.mentible.com` → CNAME `mentible-app.web.app` (Firebase project `mentible-app`)

  This was set up **outside the `mambakkam.net` pipeline** (early/standalone brand
  domain) and is **not** part of any deploy script here. **Status as of 2026-06-28:
  NOT serving — the Firebase TLS certificate has EXPIRED**, so HTTPS fails in all
  browsers ("can't be reached"); port 80 just 301s to the broken HTTPS. Firebase
  normally auto-renews; a lapse like this usually means the custom-domain connection
  in the Firebase console dropped out of "Connected" (Loopia DNS drift or the domain
  was removed/re-added). To revive: Firebase console → Hosting (`mentible-app`
  project) → re-verify the `mentible.com` custom domain so Let's Encrypt re-issues,
  confirming Loopia's A + TXT records match what Firebase expects. **Fix lives in
  Firebase + Loopia, not on the Hetzner VPS.**

  **Cost: the cert fix is free.** Firebase Hosting TLS certs (Let's Encrypt) and
  custom domains are free on every tier incl. the free **Spark** plan, and a static
  landing page stays well inside the free Hosting quota — re-verifying the domain is
  a $0 console operation, not a paid feature. The only recurring cost here is the
  **Loopia domain registration renewal** (annual, separate from Firebase, owed
  regardless). Blaze (pay-as-you-go) only bills if you exceed free quotas, which a
  landing page won't. (Confirm the project's plan/spend in Firebase console → Usage
  and billing if in doubt.)
- **`mentibile.com`** (note the extra "i") is a **common typo of the brand** — it has
  **no DNS** and is not registered/controlled by us.

> Decision still open: whether to revive `mentible.com` as the public front door or
> keep everything on `mambakkam.net`. Until decided, the expired-cert domain is a
> dead end and should not be linked from any surface.
