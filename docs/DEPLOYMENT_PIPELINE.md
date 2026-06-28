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

**Decision (2026-06-28): the canonical public URL for Mentible is
`https://mambakkam.net/mentible`.** The live product is served **entirely under
`mambakkam.net`** (see the surface table above). There is **no standalone Mentible
domain** under our control.

- **`mentible.com` is NOT ours.** Investigation on 2026-06-28 established that neither
  we nor any associate ever registered it — it is owned by an **unrelated third
  party**. WHOIS: registrar **Ascio** (reseller **Loopia**, `ns1/ns2.loopia.se`),
  created 2025-08-28, registrant privacy-redacted (country SE). We **cannot** access
  its registrar/DNS account, so we **cannot** point it anywhere. Do not treat
  `mentible.com` as a Mentible property; **do not link it from any surface.** (Brand
  note: a third party holding the `.com` is relevant to the pending trademark
  clearance — see ADR-006.)

- **Orphaned Firebase work (to clean up).** While trying to revive the domain we
  created a Firebase project **`mentible-web`** (under `wegofwd2020@gmail.com`) and
  deployed a redirect to `mentible-web.web.app` → `mambakkam.net/mentible`. Since we
  can't attach `mentible.com`, this serves no purpose. **Cleanup pending:** delete the
  Firebase/GCP projects **`mentible-web`** and **`mentible-web-c12b0`**, and the repo
  config under `infra/mentible-com-firebase/`. (No cost while they sit — all free-tier
  Spark — but they're dead weight.)

- **`mentibile.com`** (extra "i") is a **common typo of the brand** — no DNS, not ours.
