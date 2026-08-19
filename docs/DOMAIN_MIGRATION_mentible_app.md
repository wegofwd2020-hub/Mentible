# Domain migration — `mambakkam.net/mentible*` → `mentible.app`

**Status:** Planned (2026-08-19). DNS name `mentible.app` registered; not yet cut over.
**Goal:** move the Mentible web app, backend API, landing page, and Android release to the app's own apex domain `mentible.app`, retiring the `mambakkam.net/mentible*` sub-paths (kept alive during transition).

> **Framing.** The whole product is currently served as **sub-paths under `mambakkam.net`**. Consumers of those URLs live in THREE places, flagged throughout:
> - **[repo]** — this repo (code/config).
> - **[mambakkam-net]** — the external `wegofwd2020-hub/mambakkam-net` repo (host nginx + landing page + web-publish target). NOT in this checkout.
> - **[external]** — dashboards/infra with no repo: Cloudflare/DNS, Supabase, the VPS `.env.demo`, Google OAuth console, GitHub Releases.
>
> **Most breakage on a domain move is [external], not code.** The only hard-coded browser-origin in code is `backend/config.py:245` (`cors_allow_origins`). Auth redirect (web) is computed from `window.location`; API base is build-injected; JWKS/OIDC is Supabase-bound, not domain-bound — none change unless you also move Supabase.

---

## 0. Decisions (make first — they gate half the steps)

Recommended answers pre-filled; **confirm before executing.**

- [ ] **D1 — API origin.** Same-origin `mentible.app/api` **(recommended: no CORS, no new cert SAN, mirrors today)** vs split `api.mentible.app` (reintroduces a DNS record + Origin-Cert SAN + CORS).
- [ ] **D2 — App location.** Root `mentible.app/` **(recommended for a dedicated domain)** vs subpath `mentible.app/app`. Put the demo at `/demo`.
- [ ] **D3 — Web host.** New Cloudflare Pages project for `mentible.app` **(recommended)** vs reuse the mambakkam-net publish pipeline nested.
- [ ] **D4 — Supabase project.** Keep it **(recommended — issuer/JWKS/audience are Supabase-bound, not domain-bound)**.
- [ ] **D5 — GitHub Releases / APK repo.** Keep on `mambakkam-net` **(recommended — the download URL is a GitHub URL, domain-independent)**.
- [ ] **D6 — Backend VPS.** Keep `178.105.160.62` **(recommended — just add an nginx vhost)**.

*The checklist below assumes **D1 same-origin + D2 root**. If you choose split-origin, the CORS + cert-SAN items marked `[split-only]` activate.*

---

## 1. In-repo changes `[repo]`

- [ ] **`scripts/deploy/web-deploy.sh`** — the deploy engine:
  - [ ] `API_BASE_URL` default (L38) → `https://mentible.app/api`
  - [ ] `SUBPATH` cases (L32-33) → root (`""` / `app`) + `demo`
  - [ ] `baseUrl` `sed` rewrite (L69) + the `grep -q "/$SUBPATH/_expo/"` assert (L88) — **verify a root `baseUrl:"/"` emits `/_expo/` and the grep still matches** (may need to special-case root)
  - [ ] `MB_URL` (L39), `VERIFY_URL` (L40), `Deploy` workflow watch (L121-123), Supabase-allowlist reminder string (L132) → new host / repo / URL
- [ ] **`mobile/app.json:44`** — `experiments.baseUrl` `/demos/mentible` → `/` (bakes `_expo/` asset paths into the export)
- [ ] **`backend/config.py:245`** — `cors_allow_origins` default `https://mambakkam.net` → `https://mentible.app` (update even for same-origin, as safety)
- [ ] **`backend/tests/test_cors_allowlist.py:19`** — asserts the exact allowlist value → update or CI fails
- [ ] **APK build** (`Plans/DEPLOY_OPEN_SHELVES_APK_STAGE3.md` L67 export + L85 Hermes-grep assert) — exported `EXPO_PUBLIC_API_BASE_URL` + the bundle-grep string → new API base
- [ ] **`mobile/.env.local`** — `EXPO_PUBLIC_API_BASE_URL` dev/build value
- [ ] **Cosmetic (non-breaking courtesy strings):**
  - [ ] `backend/src/shelves/feed_fetch.py:23` + `mobile/src/openshelves/fetchFeed.ts:13` — feed User-Agent `Mentible (+https://mambakkam.net/mentible)`
  - [ ] `mobile/src/openshelves/opds12.ts:12` — support email `support_mentible@mambakkam.net` (only if migrating email)
- [ ] **Docs sweep** — `README.md`, `CLAUDE.md`, `docs/DEPLOYMENT_PIPELINE.md`, `docs/STATUS.md`, `docs/GO_LIVE.md`, `docs/user-guides/01-sign-in-with-google.md`, funnel specs: update surface tables + the now-obsolete "no standalone Mentible domain" statements; make `mentible.app` the canonical.

---

## 2. External / manual (NOT in this checkout)

- [ ] **DNS + Cloudflare `[external]`** — point `mentible.app` (apex; add `api.` `[split-only]`). CF zone, DNS records, Origin Cert SAN for any new hostname, SSL mode.
- [ ] **`mambakkam-net` repo `[mambakkam-net]`:**
  - [ ] Host **nginx vhost** (`infra/nginx/*.conf`) — `server_name mentible.app`, `location /api/` → `127.0.0.1:8092` (same-origin), or a new `api.mentible.app` server block `[split-only]`
  - [ ] **Landing page `src/pages/mentible.astro`** — copy, **canonical URL, OG `url`/`image`, sitemap host**, "Download Android app" link
  - [ ] Web publish destination + the `Deploy` workflow / new CF Pages project (per D3)
- [ ] **VPS `.env.demo` `[external]`** (`178.105.160.62`, `/opt/mentible/`, root-owned) — set `CORS_ALLOW_ORIGINS=https://mentible.app` `[split-only]`. No other domain-tied keys; port binding unchanged.
- [ ] **⭐ Supabase → Auth → URL Configuration `[external]`** *(the #1 silent break — do BEFORE anyone signs in on the new domain):*
  - [ ] **Site URL** → `https://mentible.app/`
  - [ ] **Redirect URLs** → add `https://mentible.app/**`; keep `mentible://**` (mobile) + localhost (dev)
- [ ] **Google Cloud OAuth console `[external]`** — add the new web origin to the Google provider's authorized JS origins/redirects
- [ ] **GitHub Releases `[external]`** — update the landing APK link only if the tag/repo changes (else leave `releases/latest/download/Mentible.apk`)

---

## 3. Mobile / APK cutover `[repo]` + `[external]`

- [ ] Bump to **vc43** (`mobile/app.json` + `mobile/android/app/build.gradle`)
- [ ] Build with the new API base baked: `export EXPO_PUBLIC_API_BASE_URL="https://mentible.app/api"; ./gradlew assembleRelease`
- [ ] Verify the Hermes bundle: prod URL present, **no localhost/10.0.2.2**, cert SHA-256 `894ba417f6c833fc…`
- [ ] Publish release `mentible-0.2.x-vc43` (+ `Mentible.apk` for the stable latest link) on `mambakkam-net`; update landing link
- [ ] `mentible://` deep-link scheme is **unaffected** — keep it

---

## 4. ⚠ Load-bearing gotchas

- [ ] **Old APKs (vc ≤ 42) have `https://mambakkam.net/mentible-api` baked in** — a baked URL cannot be remote-updated. **Keep `mambakkam.net/mentible-api` proxying to the same backend** until old installs age out (or ship a forced-update). **Do NOT decommission the old API path on cutover day.**
- [ ] **Supabase redirect allowlist must include the new origin before users hit it** — else OAuth returns a dangling `?code` and login silently fails.
- [ ] **CORS** `[split-only]`: `config.py:245` default + its test must name `mentible.app` or the web app is CORS-blocked. Same-origin sidesteps this.
- [ ] **`mentible.com` is third-party-owned** (not us) — `mentible.app` is the new canonical; don't confuse.
- [ ] **CF cached-404 self-heal**: on first deploy, verify the live hashed `entry-*.js` carries the build, not just a 200.

---

## 5. Cutover order (zero-downtime)

1. [ ] Code changes (§1) on a branch; keep the mambakkam.net deploy working.
2. [ ] Stand up `mentible.app` **in parallel** (DNS, host, backend vhost, new API base) — both domains live.
3. [ ] Add Supabase redirect + Google OAuth origins for the new domain (§2).
4. [ ] Build + verify web on `mentible.app`; build + verify APK vc43 against the new API (§3).
5. [ ] Flip the landing page + canonical to `mentible.app`.
6. [ ] Add a **301** `mambakkam.net/mentible* → mentible.app` in mambakkam-net nginx — but **keep `mambakkam.net/mentible-api` proxying** for old APKs.
7. [ ] Update docs + the resume pin.

---

## Appendix — full reference inventory (file:line)

**Hard-break surfaces (prod breaks if unmigrated):**
- `backend/config.py:245` — CORS default `https://mambakkam.net` (NOT overridden in `docker-compose.demo.yml` → prod inherits this). `[split-only]` hard break; update regardless.
- `backend/tests/test_cors_allowlist.py:19` — pins that value.
- `scripts/deploy/web-deploy.sh` — L32-33 (SUBPATH), L38 (API base), L39 (MB_URL publish repo), L40 (VERIFY_URL), L69 (baseUrl sed), L88 (`_expo` assert), L121-123 (deploy workflow), L132 (reminder).
- `mobile/app.json:44` — `experiments.baseUrl`.
- Supabase Auth Redirect URLs `[external]`.
- Host nginx `location /mentible-api/` `[mambakkam-net]` (documented at `docker-compose.demo.yml:9-13`).

**Cosmetic / courtesy (no functional break):**
- `backend/src/shelves/feed_fetch.py:23`, `mobile/src/openshelves/fetchFeed.ts:13` — feed User-Agent URL.
- `mobile/src/openshelves/opds12.ts:12` — `support_mentible@mambakkam.net`.
- `scripts/perf/latency_probe.py:31` — `DEFAULT_BASE` (env `MENTIBLE_API_BASE` overrides).
- Many `docs/**` + `README.md` + `CLAUDE.md` surface tables.

**Env/build-injected (no hardcoded mambakkam in code — but the VALUE must change at deploy time):**
- `mobile/src/api/client.ts:21-27` `resolveBaseUrl()` ← `EXPO_PUBLIC_API_BASE_URL`.
- `mobile/src/lib/supabase.ts:15-16` ← `EXPO_PUBLIC_SUPABASE_URL` (Supabase-hosted — unaffected).

**NOT affected by a web-domain move (Supabase-bound, not domain-bound):**
- `OIDC_ISSUER` / `OIDC_AUDIENCE` / JWKS (`backend/src/auth/verifier.py`), `DATABASE_URL`, `SUPER_ADMIN_*`, `SYSTEM_OWNER_SECRET` — change only if the Supabase project itself moves (D4 = keep).
- Web auth redirect (`mobile/src/auth/googleSignIn.ts:37`, `authRedirect.ts`) — computed from `window.location`, self-adjusts; only the Supabase allowlist needs the new origin.

**Optional net-new (only if you want `https://mentible.app` links to open the app — Android App Links):**
- Add an `autoVerify` intent-filter with `host="mentible.app"` in `mobile/android/app/src/main/AndroidManifest.xml` (today: custom-scheme `mentible://` only, no `https` App Link).
- Publish `/.well-known/assetlinks.json` on `mentible.app` with the release cert SHA-256 `89:4B:A4:17:F6:C8:33…`.
- Not required — the `mentible://` scheme keeps working regardless.

**Legacy hosts to note:** `fly.toml` / `docs/DEPLOY_FLY.md` reference an OLD Fly.io backend (`studybuddyq-backend.fly.dev`) — not current prod; decommission-flag only.
