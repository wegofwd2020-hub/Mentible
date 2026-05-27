# Deploy the backend to Fly.io

Gets the StudyBuddy Q backend (`POST /generate`, `/structure`, `/export`, `/jobs/{id}`)
onto a public HTTPS URL — the prerequisite for building an Android APK that real
devices can reach. Config lives in `fly.toml` (repo root); the image is
`backend/Dockerfile` (Python API + bundled Node compiler).

All commands run from the **repo root**. Steps that need your Fly account are
marked **(you)** — run them yourself (e.g. prefix with `!` in this session) since
they're interactive / credentialed.

## 0. Install flyctl — (you)
```bash
curl -L https://fly.io/install.sh | sh    # then add the printed path to your shell
fly version
```

## 1. Log in — (you)
```bash
fly auth login
```

## 2. Create the app
`fly.toml` already names the app `studybuddyq-backend`. Register that name without
deploying yet (pick another name if it's taken, and update `app` in `fly.toml`):
```bash
fly apps create studybuddyq-backend
```

## 3. Provision Redis (Upstash, managed)
`/generate` and `/structure` need Redis (`/export` does not). Create one and note
the URL it prints:
```bash
fly redis create            # choose the same primary region (iad); free plan is fine
fly redis status <name>     # shows the redis:// (or rediss://) connection URL
```

## 4. Set secrets (never commit these)
```bash
# Redis URL from step 3:
fly secrets set REDIS_URL="redis://default:...@...upstash.io:6379"

# BYOK envelope master key — 32 bytes hex, generated at set-time so it's never
# printed or stored anywhere but Fly:
fly secrets set BYOK_MASTER_KEY="$(openssl rand -hex 32)"
```

## 5. Deploy
```bash
fly deploy            # builds backend/Dockerfile from the repo-root context
```

## 6. Verify
```bash
APP_URL="https://studybuddyq-backend.fly.dev"
curl -fsS "$APP_URL/healthz"     # {"status":"ok"}
curl -fsS "$APP_URL/readyz"      # {"status":"ok","redis":"ok"} once Redis is wired

# End-to-end export smoke test (no key needed — /export is key-free):
curl -sS -o /tmp/smoke.epub -D - \
  --data-binary @/tmp/min-book.json \
  -H "Content-Type: application/json" \
  "$APP_URL/api/v1/export"
head -c2 /tmp/smoke.epub   # → PK  (a real EPUB)
```

## 7. Point the APK at it
```bash
cd mobile
eas build --platform android --profile preview \
  --env EXPO_PUBLIC_API_BASE_URL="https://studybuddyq-backend.fly.dev"
```

## Notes
- **Cost / sleep:** `auto_stop_machines` + `min_machines_running = 0` means the
  machine sleeps when idle and cold-starts on the next request (a few seconds) —
  cheap, fine for testing. Set `min_machines_running = 1` for an always-warm URL.
- **Diagrams:** `/export` here renders diagrams as the lightweight placeholder
  (no headless Chromium in the image). Full Mermaid→SVG (`--mermaid`) needs a
  heavier image and is a separate follow-up.
- **Secrets** are managed by Fly (`fly secrets list`); they are never in
  `fly.toml` or git.
