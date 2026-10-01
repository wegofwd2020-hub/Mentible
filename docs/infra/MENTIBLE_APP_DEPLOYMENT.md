# mentible.app Deployment & Troubleshooting

## Stack

```
mentible.app (nginx)
  ├─ / → astrowind container (8080)      [web app: Expo export]
  └─ /api/ → mentible backend (8001)     [FastAPI on Mentible)

Astrowind built from: mambakkam-net repo, public/mentible-app/ files
Backend: /opt/mentible docker-compose.demo.yml
```

## Web App Deploy Flow

1. **Build locally** (Mentible repo)
   ```bash
   scripts/deploy/web-deploy.sh mentible
   ```
   - Builds Expo web export from origin/main
   - Pushes to mambakkam-net repo at public/mentible-app/
   - Triggers GitHub Actions auto-deploy (currently broken — see note below)

2. **Manual sync to VPS** (workaround while auto-deploy is broken)
   ```bash
   # On VPS
   cd /tmp
   git clone --depth 1 https://github.com/wegofwd2020-hub/mambakkam-net.git
   cp -r mambakkam-net/public/mentible-app/* /opt/mambakkam/public/mentible-app/
   
   # Rebuild astrowind container (bakes files into image)
   cd /opt/mambakkam
   docker compose build --no-cache astrowind
   docker compose up -d astrowind
   ```

3. **Verify nginx routing** (critical)
   - Check `/etc/nginx/sites-enabled/mentible.app.conf`
   - `location /` must proxy to `127.0.0.1:8080` (astrowind)
   - `location /api/` must proxy to `127.0.0.1:8001` (API)
   - If wrong: update and reload
     ```bash
     sudo nginx -t && sudo systemctl reload nginx
     ```

## Known Issues

- **Auto-deploy broken (GitHub Actions)**: The mambakkam-net deploy Action fails at the SSH step. Files stay stuck in the repo, never reach the VPS. Requires manual sync (step 2 above).
- **nginx routing typo risk**: Both / and /api/ default to 8001 in a fresh config. Astrowind on 8080 means root traffic 404s silently until nginx is fixed. No fallback, no error — just a 404 from the API.

## Verification

After deploy:
```bash
# Check astrowind is serving (HTML response)
curl -s http://127.0.0.1:8080/ | head -1   # should be <!DOCTYPE html>

# Check mentible.app is live
curl -s https://mentible.app/ | head -1     # same

# Test auth (should 200 with token)
curl -s https://mentible.app/api/v1/auth/session -H "Authorization: Bearer $TOKEN"
```

## Rollback

If astrowind breaks:
```bash
cd /opt/mambakkam
docker compose up -d astrowind  # restart from last image
# or
docker compose build astrowind && docker compose up -d astrowind  # rebuild from current files
```
