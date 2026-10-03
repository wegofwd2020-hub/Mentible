# Local Staging Environment Setup

**Purpose:** Test features (migrations, API changes, admin flows) on localhost before deploying to production VPS.

**Stack:** Docker Compose (api, celery-worker, celery-beat, redis) + external PostgreSQL

---

## Quick Start

### 1. Prepare Environment

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible

# Create .env.staging from template
cp .env.staging.template .env.staging

# Edit .env.staging and fill in:
# - BYOK_MASTER_KEY (generate: openssl rand -hex 32)
# - SYSTEM_OWNER_SECRET (generate: openssl rand -hex 32)  
# - DATABASE_URL (PostgreSQL connection string)
# - OIDC_ISSUER (optional, for identity testing)
```

### 2. Start Staging

```bash
./scripts/setup-staging.sh
```

This script:
- Generates missing encryption keys
- Validates DATABASE_URL
- Starts Docker containers (api, worker, beat, redis)
- Runs `alembic upgrade head` to initialize DB schema
- Waits for API healthz

### 3. Verify Running

```bash
curl http://127.0.0.1:8093/healthz
# Expected: 200 OK

docker compose -f docker-compose.staging.yml ps
# Should show: mentible-staging-api, mentible-staging-celery-worker, 
#              mentible-staging-celery-beat, mentible-staging-redis
```

---

## Configuration

### Ports
- **Dev:** `127.0.0.1:8001` (docker-compose.yml, local uvicorn --reload)
- **Staging:** `127.0.0.1:8093` (docker-compose.staging.yml, production-shaped)
- **Prod:** `127.0.0.1:8092` (docker-compose.demo.yml on VPS, proxied via nginx)

### Database Options

#### Option A: Local PostgreSQL (Simplest)
```bash
# Install Postgres locally (macOS: brew install postgresql@15)
# Start: postgres -D /usr/local/var/postgres

# In .env.staging:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mentible_staging
```

#### Option B: Docker Postgres Service
Add to `docker-compose.staging.yml` under `services:`:
```yaml
  staging-db:
    image: postgres:15-alpine
    container_name: mentible-staging-db
    environment:
      POSTGRES_DB: mentible_staging
      POSTGRES_PASSWORD: postgres
    ports:
      - '127.0.0.1:5433:5432'  # Avoid conflict with any prod postgres
    volumes:
      - mentible-staging-db:/var/lib/postgresql/data

# In .env.staging:
DATABASE_URL=postgresql://postgres:postgres@staging-db:5432/mentible_staging
```

---

## Testing Phase 4 Flow

### 1. Create Test User (if using identity)

Set in `.env.staging`:
```
OIDC_ISSUER=https://your-supabase-url
SUPER_ADMIN_EMAILS=you@example.com
```

Then sign in via the mobile app (pointing to `http://127.0.0.1:8093`).

### 2. Manual Test Sequence

#### Free User (No Pro)
1. Publish a project → verify 1st publish succeeds
2. Repeat 9 more times (total: 10)
3. Try 11th publish → expect `429 Too Many Requests` ("upgrade to Pro")
4. Search projects: `GET /common-projects?q=test`
5. Import a project → verify title conflict handling
6. View published project in detail

#### Admin User
1. Add email to `SUPER_ADMIN_EMAILS` in `.env.staging`, restart
2. Navigate to `Admin → Common projects`
3. Takedown a project (provide reason)
4. Verify project hidden from public list
5. Restore project
6. Verify in public list again
7. Check audit trail: `SELECT * FROM admin_audit WHERE action LIKE 'common_project%'`

#### Pro User (Optional)
1. Publish 20+ projects → all should succeed (no quota)
2. Verify tokens/quotas in usage dashboard

### 3. Check Logs

```bash
# API logs (generate calls, migrations, errors)
docker compose -f docker-compose.staging.yml logs -f api

# Worker logs (async jobs: generations, celery tasks)
docker compose -f docker-compose.staging.yml logs -f celery-worker

# Beat logs (scheduled tasks)
docker compose -f docker-compose.staging.yml logs -f celery-beat
```

---

## Common Tasks

### Restart Services
```bash
docker compose -f docker-compose.staging.yml restart api
```

### Access Container Shell
```bash
docker compose -f docker-compose.staging.yml exec api bash
```

### Run Custom Alembic Command
```bash
docker compose -f docker-compose.staging.yml run --rm api \
  alembic -c /app/backend/alembic.ini downgrade -1
```

### Drop & Recreate DB
```bash
# In .env.staging DATABASE_URL, change DB name to mentible_staging_fresh
# Or manually:
docker compose -f docker-compose.staging.yml down -v  # Remove volumes
# Re-run setup-staging.sh
```

### Tail Logs in Real-Time
```bash
docker compose -f docker-compose.staging.yml logs -f --tail=50
```

### Stop Staging
```bash
docker compose -f docker-compose.staging.yml down
# Volumes persist; restart with: docker compose ... up -d
```

### Remove Everything (Fresh Start)
```bash
docker compose -f docker-compose.staging.yml down -v
./scripts/setup-staging.sh  # Rebuild from scratch
```

---

## Troubleshooting

### API container exits immediately
- Check logs: `docker compose -f docker-compose.staging.yml logs api`
- Verify .env.staging has all required fields
- Check DATABASE_URL is reachable

### Migration fails
- Verify DATABASE_URL exists and is writable
- Check migration files are in `backend/alembic/versions/`
- Try: `docker compose ... run --rm api alembic current` (show current version)

### "Connection refused" on database
- Verify PostgreSQL is running locally (if using local DB)
- Verify DATABASE_URL matches actual service (host/port)
- If using Docker postgres, wait a few seconds for it to start

### Redis errors
- Staging redis runs in compose network, not on host
- Only accessible from api/worker/beat containers
- Check: `docker compose ... exec redis redis-cli ping`

### Port 8093 already in use
- Find process: `lsof -i :8093`
- Kill: `kill -9 <pid>`
- Or change port in docker-compose.staging.yml: `'127.0.0.1:8094:8000'`

---

## Next: Deploy to Production

Once testing passes on staging:

```bash
# Stop staging (preserve code for comparison)
docker compose -f docker-compose.staging.yml down

# Deploy to VPS (see deployment docs)
./mentible_vps_deploy.sh

# Verify prod health
curl https://mambakkam.net/mentible-api/healthz
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│         Developer Localhost                     │
├─────────────────────────────────────────────────┤
│                                                 │
│  Dev Stack (docker-compose.yml)                │
│  ├─ api:8001 (uvicorn --reload)               │
│  └─ redis:6380                                 │
│                                                 │
│  Staging Stack (docker-compose.staging.yml)   │
│  ├─ api:8093 (prod image)                     │
│  ├─ celery-worker:none                        │
│  ├─ celery-beat:none                          │
│  ├─ redis:none (network-only)                 │
│  └─ (External: PostgreSQL localhost:5432)     │
│                                                 │
└─────────────────────────────────────────────────┘
              │                    │
              │ Test              │ Commit to main
              │                    │
              ▼                    ▼
        Staging Tests        VPS Production
      (Phase 4 flow)         (/opt/mentible:8092)
```
