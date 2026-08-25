# Production Hosting — Options & Cost

> **Status:** Proposal / options analysis. **Date:** 2026-08-25.
> **Ask:** Current hosting (Hetzner + Supabase) is performance-constrained. What are the
> options to make Mentible truly production-ready, and what do they cost?
> **Calibration (confirmed):** target = **small beta (tens of users)** · **minimize ops**
> (prefer managed PaaS) · **open to any provider**.
> **Companion:** [`cost-model-byok-unit-economics.md`](../research/cost-model-byok-unit-economics.md)
> · `Plans/DEPLOY_FLY.md` · `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md` · ADR-005 (infra/money).

---

## 0. TL;DR

- **At tens of users, the constraint is not compute capacity — it's reliability + deploy
  safety + one bottleneck:** headless Chromium (the EPUB/PDF compiler, "108 Chromium passes,
  minutes-long") shares the **same box** as the API, Celery workers, and Redis, so a compile
  starves live requests. Fix *that*, not raw scale.
- **Highest-ROI fixes are provider-independent** (do them regardless of where you host):
  **(1)** move the Chromium compiler off the API's box (separate worker/queue), **(2)** move ZK
  EPUB blobs out of Postgres into **object storage (Cloudflare R2)**, **(3)** put a **CDN**
  (Cloudflare) in front of the web app + downloads, **(4)** kill the rebuild-on-VPS deploy.
- **Recommended for your calibration: Option B — managed PaaS (Fly.io).** Push-to-deploy, no
  single box, container-native (you're already Dockerized), EU regions available. Pairs with
  **Supabase Pro + R2 + Cloudflare CDN**. **~$40–90/mo** at beta scale.
- **Option A (harden current Hetzner)** is cheaper (**~$30–55/mo**) and a valid stepping-stone;
  **Option C (full cloud, AWS/GCP)** is overkill for tens of users — documented for the future.
- **Confirmed adoption = phased "start lowest-end, upgrade on triggers" (§5.1):** Phase 0 keeps the
  current Hetzner box + cheap *portable* fixes (~$25–35/mo); Phases 1–2 are pull-when-needed, gated
  on real signals, with **no rework** because the portable fixes come first. "Start low, upgrade
  later" is sound **only if** low-end choices are upgrade-compatible — the §5.1 lock-in traps say how.

---

## 1. Where we are (and why it's constrained)

Grounded in the repo on 2026-08-25:

- **One Hetzner box, containerized** — `backend/Dockerfile` + `docker-compose.yml` run **FastAPI +
  Celery workers + Redis + headless Chromium** together. The compiler image bakes Node + Chromium
  (`backend/src/export/tasks.py`, `compiler.py`).
- **Async** = Celery, broker + result backend both on the **same Redis** (`core/celery_app.py`).
- **DB + Auth** = **Supabase** — Postgres via asyncpg (`config.py:154`), Auth/JWKS as IdP
  (`config.py:61-67`).
- **Storage** = published artifacts on **VPS disk** (`library/artifact_store.py`); synced ZK
  EPUB/book blobs as **base64 ciphertext in Supabase Postgres** (`sync/schemas.py`).
- **Web** = static Expo bundle; deploy = **push → GH-Actions SSHes to the VPS and rebuilds**
  (`scripts/deploy/web-deploy.sh`; the source of the "hung on VPS" deploy saga).

### The actual bottlenecks

| # | Constraint | Why it hurts |
|---|---|---|
| 1 | **Chromium compiler co-located** with API/workers/Redis on one box | Minutes-long diagram renders (108 passes) spike CPU/RAM and **starve live API requests**. The #1 perf issue. |
| 2 | **Single box = single point of failure**, no autoscale | Any crash/OOM/deploy = full outage. No headroom for a usage spike. |
| 3 | **Deploy rebuilds on the VPS** | Fragile, slow, can hang (orphaned remote build); no rolling/zero-downtime deploy. |
| 4 | **ZK blobs in Postgres** | Bloats the DB (500 MB free-tier cliff), pressures connections, adds egress — Postgres is the wrong store for large blobs. |
| 5 | **No CDN** in front of web/downloads | Global latency + all egress billed through the origin box. |
| 6 | **Single Redis, single region (EU)** | No HA; global users see latency. Fine at beta, not "production" at scale. |

> **Honest framing:** for *tens* of users the box has plenty of raw capacity. "Production-ready"
> here means **remove the compile contention, stop single-box outages, and make deploys safe** —
> not "scale to thousands." Don't over-build.

---

## 2. Cross-cutting fixes (do these in ANY option)

These are the highest-ROI changes and are **provider-independent** — they improve even the current
Hetzner box:

1. **Decouple the Chromium compiler** — run EPUB/PDF compile as its **own worker/queue** (separate
   process, ideally separate machine/container with more RAM), so a compile never blocks the API.
   Celery already exists; this is a dedicated queue + worker, not new architecture.
2. **Blobs → object storage (Cloudflare R2)** — move synced ZK ciphertext out of Postgres into R2
   (~$0.015/GB-mo, **$0 egress**). Safe *because* zero-knowledge — the server only holds ciphertext
   it can't read (ADR-014). Keep only the metadata row in Postgres. Fixes bottleneck #4 **and** the
   egress cost from the companion note.
3. **CDN in front of web + downloads (Cloudflare)** — offload static serving + artifact downloads;
   cuts origin egress and global latency. Free tier is enough at beta.
4. **Rolling, registry-based deploy** — build image in CI → push to a registry → platform pulls +
   rolling-restarts. Kills the rebuild-on-VPS fragility (bottleneck #3).
5. **Managed Postgres with pooling** — Supabase Pro (pooler) or a managed PG; stop direct-connection
   exhaustion under concurrency.
6. **Backups + health checks + basic observability** — automated DB backups, container health
   checks, uptime + error monitoring (e.g. UptimeRobot free + Sentry free tier).

---

## 3. The options

### Option A — Harden the current Hetzner + Supabase
Keep Hetzner; apply the cross-cutting fixes on it.
- Split docker-compose so the **compiler runs as a separate container/worker** (own CPU share); API
  + Celery + Redis stay, but compile no longer starves them. Optionally a **second small Hetzner box**
  for the compiler.
- Add **Cloudflare CDN + R2**; upgrade **Supabase Pro**; add backups + monitoring.
- **Pros:** cheapest; best raw $/performance (Hetzner is unbeatable there); EU data; minimal
  migration. **Cons:** still self-managed servers; still ~single-box unless you add the 2nd box;
  deploy safety needs the registry/rolling work by hand.
- **Fits:** budget-lean beta; you're comfortable with servers. *(You chose "minimize ops," so this is
  the stepping-stone, not the destination.)*

### Option B — Managed PaaS (Fly.io) + Supabase Pro + R2 + Cloudflare  ⭐ recommended
Move the containers to a managed platform; keep the good parts.
- **Fly.io** runs your existing images: one **API** machine + one **worker/compiler** machine (more
  RAM for Chromium) + **managed Redis** (Upstash/Fly). Push-to-deploy, rolling restarts, health
  checks, **EU regions**, scale-to-two when needed. (`Plans/DEPLOY_FLY.md` already scopes this.)
- **Supabase Pro** for Postgres/Auth; **R2** for blobs; **Cloudflare** CDN for web + downloads.
- **Pros:** no single box; safe rolling deploys out-of-the-box; minimal ops; container-native (small
  migration since you're already Dockerized); painless path from "2 machines" to "autoscale" later.
- **Cons:** slightly pricier per unit compute than Hetzner; another vendor. **Alternatives:** Render
  or Railway are near-equivalent (web service + background worker + managed PG) — pick on DX
  preference.
- **Fits:** exactly your calibration — **minimize ops, open provider, beta scale with a clean path
  up.**

### Option C — Full managed cloud (AWS / GCP)
Managed everything: **RDS/Cloud SQL** (Postgres), **ECS-Fargate/GKE** (containers), **S3 +
CloudFront**, **ElastiCache** (Redis).
- **Pros:** most scalable + integrated; every component HA/multi-AZ; the "no ceiling" answer.
- **Cons:** **overkill for tens of users**; highest cost; most ops/complexity (IAM, VPC, Terraform).
- **Fits:** 10k+ scale / enterprise procurement — **not now.** Documented so the path is known.

---

## 4. Cost (monthly, beta scale — verify live; 2026 ballparks)

| Component | Option A (Hetzner hardened) | Option B (Fly.io PaaS) ⭐ | Option C (AWS/GCP) |
|---|---|---|---|
| **Compute — API** | Hetzner CPX31 shared ~€16 | Fly API machine (shared-1x, 512MB–1GB) ~$5–15 | Fargate task(s) ~$20–40 |
| **Compute — worker/compiler** | shared on same box, or 2nd CPX21 ~€8 | Fly worker machine (1–2GB for Chromium) ~$10–25 | Fargate task ~$20–40 |
| **Redis** | on-box (free) | Upstash/Fly managed ~$0–10 | ElastiCache ~$15–30 |
| **Postgres + Auth** | Supabase Pro ~$25 | Supabase Pro ~$25 | RDS db.t4g.micro ~$15–30 (+ separate auth) |
| **Object storage (blobs)** | R2 ~$0–5 (10GB free, $0 egress) | R2 ~$0–5 | S3 ~$1–5 + egress |
| **CDN** | Cloudflare free (Pro $20 opt.) | Cloudflare free | CloudFront ~$5–20 |
| **Backups + monitoring** | ~$0–10 (UptimeRobot/Sentry free tiers) | ~$0–10 | ~$10–20 |
| **Domains** | ~$2–3 (mentible.app + mambakkam.net) | ~$2–3 | ~$2–3 |
| **≈ Monthly total** | **~$30–55** | **~$40–90** | **~$150–400+** |

*Fixed/one-time (all options): Google Play $25 one-time; Apple $99/yr if/when iOS ships.*

> **Costs not fully in this monthly table:** **(a) monitoring/usage tracking** and **(b) migration
> cost/downtime** — see **§5.2**; **backup/restore** — see **§5.3** (~$0 beyond Supabase Pro at
> beta; PITR ~$100/mo is deferrable); **security** — see **§5.4** (~$0 at beta; Cloudflare free tier
> + already-built controls).

**Read:** Option B costs ~$10–35/mo more than A but buys **no single box, safe rolling deploys, and
near-zero ops** — the exact things your "minimize ops" answer asked for. Option C's premium buys
scale you don't need yet.

---

## 5. Recommendation

**Staged, lean:**

1. **Now (provider-independent, biggest wins):** do cross-cutting fixes **1–3** — decouple the
   Chromium compiler, move blobs to R2, put Cloudflare in front. These fix the real bottlenecks and
   help even on the current box, so they're never wasted work.
2. **Then (the migration):** move the two containers to **Fly.io** (Option B) with **Supabase Pro +
   managed Redis**, and switch to **registry + rolling deploy**. This retires the single-box outage
   risk and the rebuild-on-VPS fragility with minimal ops. `Plans/DEPLOY_FLY.md` is the head start.
3. **Later (only if scale demands):** revisit Option C when you're past low-thousands of users or
   need multi-region/HA guarantees.

Everything here is reversible and incremental — you're not rebuilding, you're **decomposing one box
into managed pieces**, which is exactly the container work you've already done half of.

---

## 5.1 Adoption path — start lean, upgrade on triggers (confirmed approach)

**Confirmed strategy: start at the lowest end and upgrade infrastructure as needed.** This is sound
— with one rule: **every low-end choice must be upgrade-compatible, not throwaway.** Do the cheap
*portable* fixes now (they carry unchanged to every tier); defer the expensive migrations behind
**explicit triggers**, so "upgrade later" is a plan, not a hope.

### Phases

| Phase | What runs | Cost/mo | When |
|---|---|---|---|
| **0 — Lowest end (now)** | Current **Hetzner box** (API + Celery + Redis + compiler as-is) + **portable fixes**: blobs→**R2**, **Cloudflare CDN** (free), automated **backups**, **uptime + error monitoring** | **~$25–35** | Beta, tens of users |
| **1 — Managed PaaS (first upgrade)** | **Decouple the compiler** to its own worker + move containers to **Fly.io** + **Supabase Pro** + managed Redis + **rolling deploy** | **~$40–90** | On any trigger below |
| **2 — Cloud / HA** | AWS/GCP managed everything, multi-AZ/region | **~$150–400+** | Low-thousands+ users / HA or multi-region required |

### Upgrade triggers (signal → action)

| Trigger (observed signal) | Upgrade to do |
|---|---|
| API latency/timeouts spike **during EPUB/PDF compiles** | Phase 1 — decouple the compiler onto its own worker/machine (do this one **first**; it's the real bottleneck) |
| A crash/OOM/deploy causes a **user-visible outage** | Phase 1 — Fly.io (no single box) + rolling deploy |
| A deploy **hangs or needs manual VPS cleanup** again | Phase 1 — registry + rolling deploy retires rebuild-on-VPS |
| **Supabase free tier** hit (DB > ~500 MB, or connection/egress limits) | Supabase **Pro** + confirm blobs already on R2 (should be, from Phase 0) |
| Concurrent users routinely **contend for CPU** on the box | Phase 1 — split API/worker; scale-to-two on Fly |
| Sustained **low-thousands users**, or **multi-region/HA** contractually needed | Phase 2 — evaluate AWS/GCP |

### Lock-in traps to avoid at the low end (so upgrade = lift, not rebuild)

1. **Don't push blobs *deeper* into Postgres** — move them to R2 in Phase 0. Migrating a bloated PG
   later is the most painful backfill. (This is the single most important portable fix.)
2. **Don't hardcode single-box assumptions** — keep API and worker as separate processes/services
   even while co-located, so Phase 1 is a *move*, not a *refactor*. (Celery already gives you this
   seam.)
3. **Don't deepen the rebuild-on-VPS deploy** — build images in CI and pull them; even on Hetzner,
   run from a registry so Phase 1's rolling deploy is a config change.
4. **Keep config in env vars** (already the rule, `pydantic-settings`) — makes re-homing to Fly a
   secrets copy, not a code change.

> **Bottom line: the plan is confirmed.** Phase 0 is genuinely cheap and buys most of the
> reliability win; Phases 1–2 are pull-when-needed, gated on real signals, with no rework because
> the portable fixes were done first.

## 5.2 Two costs the phased approach adds

The multi-phase plan carries two costs the per-tier monthly tables (§4) don't fully show:
**(a) monitoring / usage tracking** — recurring, and the *prerequisite* for the whole
trigger-gated model — and **(b) migration cost + downtime** — a one-time hit at each upgrade hop.

### (a) Monitoring & usage tracking

This is **two different things**, and both are load-bearing here:

1. **Infra/app observability** — uptime, errors, latency, logs. This is what **detects the upgrade
   triggers** in §5.1. Without it, "upgrade when latency spikes during compiles" is unobservable —
   you'd only learn from an angry user. **Monitoring is not optional overhead; it's the sensor the
   phased plan runs on.**
2. **Product/usage metering** — per-account **token spend** (managed billing, ADR-005 D6), **sync
   volume** (books × size × devices → the egress driver), generation counts. This drives both
   billing *and* the cost forecast (egress/DB growth from the companion cost note).

| Piece | Tool (beta) | $/mo | Notes |
|---|---|---|---|
| Uptime/heartbeat | UptimeRobot / BetterStack free | **$0** | Alerts on outage — feeds the "user-visible outage" trigger |
| Error tracking | **Sentry** free (5k events/mo) → Team ~$26 | **$0–26** | Backend + mobile; the "we noticed vs a user told us" line |
| Metrics/logs | Fly built-in metrics / Grafana Cloud free / Supabase logs | **$0–10** | Latency-during-compile = the #1 trigger signal |
| **Usage metering** | **BUILD, not buy** — per-account token/sync counters + a small dashboard | **$0 infra / eng time** | ADR-005 D6 anticipates this; it's code, and it's how you price + forecast |

- **Recurring $:** ~**$0–35/mo** at beta (mostly free tiers).
- **The real cost is engineering + attention:** instrumenting usage metering is a small build (not
  a subscription), and someone has to *watch* the dashboards. Budget the eng time once; the ongoing
  cost is a few minutes of attention, not dollars.
- **Do this in Phase 0** — it's cheap, and every later trigger decision depends on it.

### (b) Migration cost & downtime (per upgrade hop)

Each phase transition is a **one-time** cost — engineering time, a possible maintenance window, and
risk — separate from the monthly run-rate. It shrinks the more you did portably in Phase 0.

| Hop | Main work | Downtime | Eng effort | Risk / mitigation |
|---|---|---|---|---|
| **0 → 1** (Hetzner → Fly + compiler split + Supabase Pro) | Re-home containers to Fly (config/secrets — already Dockerized); split compiler to its own worker; **Supabase Pro = plan toggle** | **Near-zero** if the blob move was done in Phase 0; else a short window | **~1–3 dev-days** | Low. DNS cutover + secrets copy. Keep the old box warm for instant rollback until DNS settles. |
| **blob move** (PG → R2, ideally *in* Phase 0) | Copy `synced_epub` ciphertext PG→R2 + router read/write change; metadata stays in PG | **Zero** with **dual-write → backfill → cutover**; or a short read-only window | **~1–2 dev-days** | Medium (it's a data backfill). **Do it early and small** — migrating a bloated PG later is the painful version. |
| **1 → 2** (Fly → AWS/GCP) | **DB migration** Supabase PG → RDS/Cloud SQL (the risky part); re-platform containers (Fargate/GKE); re-home Redis | **Planned window** (dump/restore) **or zero** via logical replication (more effort) | **~1–2 weeks** | Higher. The DB cutover is the crux; rehearse on a copy, script rollback. Only worth it at real scale. |

**Cost dimensions to remember at every hop:**
- **Downtime** — user-facing; avoidable with dual-write / logical replication / a warm rollback
  target, at the price of more eng effort. Announce a maintenance window if you accept a short one.
- **Data-egress to move** — copying blobs/DB *out* of the source provider is billed on the **source
  side** (another reason to keep blobs on R2, which has $0 egress, before any move).
- **Rollback plan** — every cutover needs a tested "revert to previous" path; keep the old
  environment alive until the new one is proven.

> **Key point:** the migration bill is **minimized by Phase 0's portable fixes.** Doing blob→R2,
> the API/worker process split, and registry-based deploy *early* means the 0→1 hop is a low-risk
> lift (~days), not a rebuild — and it removes the scariest data migration (blobs) from the bigger
> hops entirely.

## 5.3 Backup & restore

Not previously a topic — and it should be, because Mentible's spine is **append-only trust/approval
records** (ADR-037): losing those loses the product's whole value proposition. Backup strategy spans
**every** phase (it's not a tier you upgrade into) and is cheap at beta if done deliberately.

### What to back up — by criticality

| Tier | Data | Store | If lost | Priority |
|---|---|---|---|---|
| **Crown jewel** | Accounts, **trust projects/artifacts/versions/approval records**, `generation_job`, `admin_audit` | **Postgres (Supabase)** | Irreplaceable — the cited/validated spine + audit trail | **Highest** |
| **User content** | Synced **ZK EPUB/book ciphertext** | **R2** (after Phase 0) / Postgres (today) | Users lose cross-device library (device-local authored copies may survive; sync is the source of truth) | High |
| **Regenerable** | Published EPUB/PDF artifacts | **VPS disk** (`artifact_store`) | Re-compilable from book content (costs compute, not data) | Low |
| **Catastrophic-if-lost** | **App-signing keystore** (`mentible-release.keystore`), `SYSTEM_OWNER_SECRET`, Supabase keys, env config | outside the app | **Lose the keystore = you can never ship a Play Store update to existing installs.** Secrets often forgotten in backup plans | **Highest (one-time discipline)** |
| **NEVER back up** | Redis (job queue + **transient BYOK key envelopes**) | Redis | — | **Must not persist** — it holds ephemeral BYOK keys under TTL; a Redis dump would violate ADR-001 ("key never on disk"). Explicitly exclude. |

### Targets (beta)

- **RPO** (max acceptable data loss): **~24h** general; tighter for the **trust records** — they're
  quasi-legal (who approved what, when). Consider daily → hourly for the trust tables as usage grows.
- **RTO** (max time to restore): **hours** is fine at beta.
- **Code:** already backed up (Git/GitHub) — not in scope here.

### Mechanism + cost per store

| Store | Mechanism (beta) | $/mo | Notes |
|---|---|---|---|
| **Postgres** | Supabase **Pro** = daily automated backups, 7-day retention (**included in the $25**). Optional: nightly `pg_dump` → **R2** cron as a second, provider-independent copy | **$0** extra (in Pro) | The `pg_dump`→R2 copy also **de-risks the 1→2 migration** — same artifact you'd restore into RDS. |
| **PITR** (point-in-time recovery) | Supabase PITR add-on | **~$100/mo** | **Defer past beta** unless the trust records justify it sooner. Daily backup is enough for tens of users. |
| **R2 blobs** | **Object versioning** + a separate backup bucket (or account) | **~$0–few** | Durability (11 9's) ≠ backup — versioning protects against *your own* bad delete/bug, which durability doesn't. |
| **VPS artifacts** | Optional rsync → R2 (or skip — regenerable) | **~$0** | Lowest priority; re-compile if lost. |
| **Secrets / keystore** | Password manager + an **encrypted offline copy**; secrets in the platform's secret store | **$0** | One-time discipline; the highest consequence-per-effort item in the whole doc. |

- **Recurring $ at beta:** ~**$0** beyond Supabase Pro (already counted) + pennies of R2. PITR
  (~$100/mo) is the only pricey option and is deferrable.

### Two rules people skip

1. **A backup you've never restored is a hope, not a backup.** Schedule a **restore drill** — restore
   the PG dump into a scratch DB + pull a blob from the backup bucket — before onboarding real users,
   then periodically.
2. **GDPR vs backups (ADR-014 D8):** account deletion must purge within 30 days — **including from
   backups.** Daily backups with ≤30-day retention satisfy this naturally; longer retention needs a
   documented purge-from-backup step. Keep retention ≤30 days at beta to stay simple.

## 5.4 Security (and how it relates to monitoring)

**Security is not simply "part of monitoring."** They overlap in exactly one place — **security
*detection*** — which reuses the observability stack (§5.2a). The rest of security is **preventive
controls**, and much of it is **already built** in this codebase.

### The overlap: security detection (rides on monitoring)
These are security signals read through the *same* tools as observability:
- **Auth anomalies** — spikes in failed logins / JWKS-verify failures (Supabase auth logs + Sentry).
- **Abuse / rate-limit** — 429 bursts, unusual per-account volume (the usage metering from §5.2a).
- **Edge attacks** — DDoS / bad-bot / WAF hits (**Cloudflare** dashboard + alerts).
- **Dependency CVEs & secret leaks** — GitHub Dependabot + secret scanning; the repo's Semgrep.
- **Privileged-action review** — the existing **`admin_audit`** trail (ADR-020) — review, don't just store.

### Already built (preventive — credit where due)
Per CLAUDE.md's non-negotiable rules, the app already enforces:
- **BYOK key redaction** (ADR-001) — key never in a log/DB/traceback; Redis-only, TTL, shredded.
- **TLS-only**; **CSP / referrer policy** on web surfaces; key never in URL/query/our headers.
- **IdP auth via JWKS** (no home-grown password machinery); admin gated by `require_super_admin`.
- **Zero-knowledge sync** — server holds only ciphertext it can't read (ADR-014).
- **Adult-only**, minimal PII, GDPR purge schedule.

### Production hardening adds (mostly free / config)
| Control | How | $/mo |
|---|---|---|
| **DDoS + WAF** | **Cloudflare** (already in the plan for CDN) — free DDoS + basic WAF; Pro WAF/rate-rules ~$20 optional | **$0** (Pro $20 opt.) |
| **Dependency + secret scanning** | GitHub Dependabot + secret scanning; Semgrep (repo already has it) | **$0** |
| **Security monitoring/alerting** | Reuse Sentry + Cloudflare + Supabase auth logs + `admin_audit` review | **$0** (in §5.2a) |
| **Secret hygiene / rotation** | Platform secret store (Fly/Supabase); rotate keys on a cadence; keystore offline (§5.3) | **$0** |
| **Backups are a security control too** | Ransomware/bad-actor recovery = §5.3 backups | (in §5.3) |
| **Pre-launch review** | Self-run **`/security-review`** on the diff/branch; external pen-test only later | **$0** (pen-test = $$, defer) |

- **Recurring $ at beta:** ~**$0** (Cloudflare free tier + already-built controls + free scanners).
- **The cost is discipline, not dollars:** keep dependencies patched, review the audit trail, rotate
  secrets, and run `/security-review` before onboarding real users.

> **Answer to "is security part of monitoring?"** — the **detection** slice is (and it's ~$0,
> riding on the same tools); the **preventive** majority is a separate concern that's **largely
> already implemented** here. Production adds edge protection (Cloudflare WAF/DDoS) + scanning +
> a review pass, almost all free-tier at beta.

---

## 6. Open items before "go"

1. **Fly.io vs Render vs Railway** — pick on DX; all satisfy Option B. (Fly already scoped.)
2. **Redis:** managed (Upstash) vs a small Fly Redis — HA needed at beta? (Probably not yet.)
3. **Blob migration:** one-time move of existing `synced_epub` ciphertext Postgres → R2 + a router
   change to read/write R2 (metadata stays in PG). Small, but it's a migration — schedule it.
4. **Region:** single EU region is fine for beta; note it for a future multi-region decision.
5. **Compiler machine sizing:** Chromium's 108-pass diagram render sets the worker's RAM floor —
   size it from a real compile, not a guess.
6. **Observability baseline:** wire Sentry (errors) + UptimeRobot (uptime) before onboarding real
   users — cheap, and the difference between "we noticed" and "a user told us."
7. **Define the trigger metrics (§5.2a):** decide the exact signals + thresholds that fire each
   upgrade (compile-time latency, error rate, DB size, MAU) and where they're read — the phased plan
   only works if these are instrumented in Phase 0.
8. **Rehearse the 0→1 migration (§5.2b):** script the blob→R2 dual-write/backfill and the Fly
   cutover with a tested rollback, and keep the Hetzner box warm until DNS/traffic proves the move.
9. **Back up the app-signing keystore + secrets NOW (§5.3):** the one irreversible loss in the whole
   stack — password manager + encrypted offline copy, before anything else.
10. **Run a restore drill (§5.3):** restore a `pg_dump` into a scratch DB + pull a blob from the
    backup bucket, and confirm ≤30-day retention for GDPR — before onboarding real users.
11. **Turn on the free security controls (§5.4):** Cloudflare WAF/DDoS, Dependabot + secret scanning,
    and run `/security-review` on the branch before onboarding real users.

---

*Prepared from a code map (`backend/Dockerfile`, `docker-compose.yml`, `core/celery_app.py`,
`src/export/*`, `library/artifact_store.py`, `sync/schemas.py`, `config.py`,
`scripts/deploy/web-deploy.sh`) + `Plans/DEPLOY_FLY.md` on 2026-08-25. Cost figures are 2026
ballparks — verify live provider pricing before committing.*
