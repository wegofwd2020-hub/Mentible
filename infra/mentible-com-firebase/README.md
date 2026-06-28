# `mentible.com` — Firebase Hosting redirect

Minimal Firebase Hosting config that points the standalone brand domain
**`mentible.com`** at the live marketing landing page on `mambakkam.net`. This is
**off the main `mambakkam.net` deploy pipeline** — see
[`docs/DEPLOYMENT_PIPELINE.md` → Domains / DNS](../../docs/DEPLOYMENT_PIPELINE.md).

## What it does

Every path on `mentible.com` **302-redirects** to `https://mambakkam.net/mentible`
(the marketing/download landing page). The `public/index.html` is a never-served
fallback (the `"**"` redirect catches everything) that also meta-refreshes to the
same place if the redirect rule is ever removed.

## Why this exists

As of 2026-06-28 `mentible.com` was **not serving**: the Firebase TLS cert had
expired *and* the underlying `mentible-app.web.app` site returned 404. The original
`mentible-app` project turned out to be **inaccessible from our account** (owned
elsewhere or deleted), so per the "start fresh" decision a new project
**`mentible-web`** was created under `wegofwd2020@gmail.com` and this redirect was
deployed to it — giving the domain something to serve rather than maintaining a
separate landing page.

## Status (2026-06-28)

- ✅ **Redirect DEPLOYED and live** on the new project:
  `https://mentible-web.web.app/` → 302 → `https://mambakkam.net/mentible` (verified).
- ⬜ **`mentible.com` custom domain not yet connected** to `mentible-web` — still
  needed for the apex domain + fresh TLS cert (see "Remaining steps").
- ⬜ **Duplicate project `mentible-web-c12b0`** (auto-created in the console while the
  clean `mentible-web` ID was briefly taken) should be deleted.

## Deploy / re-deploy

```bash
export PATH="$HOME/.npm-global/bin:$PATH"   # firebase-tools is user-local, not in /usr
firebase deploy --only hosting --project mentible-web   # .firebaserc default = mentible-web
```

Confirm the default URL serves:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mentible-web.web.app/   # expect 302
```

## Remaining steps (manual — need console + DNS access)

**1. Connect the `mentible.com` custom domain to `mentible-web`** (gives the fresh cert):
- Firebase console → **`mentible-web` → Hosting → Add custom domain → `mentible.com`**.
- Firebase shows the exact records (an **A** record — possibly two IPs — and maybe a
  **TXT** verification). They're project-specific; the console generates them.
- In **Loopia** DNS for `mentible.com`: set the **A** record(s) to match exactly
  (current apex A is `199.36.158.100`; add the second if listed), add the **TXT** if
  asked, and repoint the **`www` CNAME** from the dead `mentible-app.web.app` to
  **`mentible-web.web.app`** (or add `www` as a second custom domain).
- Wait until the console shows **"Connected"** — Firebase auto-issues the Let's
  Encrypt cert (minutes to ~24h). Verify end-to-end:
  ```bash
  curl -sv -o /dev/null -m 10 https://mentible.com/ 2>&1 | grep -iE "expire|HTTP|location"
  # success = no "certificate expired" + 302 → https://mambakkam.net/mentible
  ```

**2. Delete the duplicate project `mentible-web-c12b0`:**
- Firebase console → **`mentible-web-c12b0` → ⚙ Project settings → Delete project**.
- Harmless if left (empty, free tier), but remove it to avoid confusion over which
  project is canonical.

## Choices you can change

- **Destination** — currently the landing page (`/mentible`). Switch to the app
  (`/app/mentible/`) by editing `destination` in `firebase.json` if you'd rather drop
  visitors straight into the product.
- **Redirect type** — currently **302 (temporary)** on purpose: 301s are aggressively
  cached by browsers and hard to undo while the "revive vs retire" decision is still
  open. Switch to **301 (permanent)** once `mentible.com` is settled as the front door.
