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
expired *and* the underlying `mentible-app.web.app` site returned 404 (no content
deployed). This config gives the site something to serve so the domain works again,
rather than maintaining a separate landing page.

## Deploy

```bash
npm i -g firebase-tools
firebase login                 # interactive — run via the ! prefix in this session
firebase use mentible-app      # uses .firebaserc default
firebase deploy --only hosting --project mentible-app
```

Then confirm the default URL serves before touching the custom domain:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mentible-app.web.app/   # expect 302
```

Custom-domain cert re-issue (Firebase console + Loopia DNS) is a **separate** step —
see the checklist in `docs/DEPLOYMENT_PIPELINE.md`. Verify end-to-end with:

```bash
curl -sv -o /dev/null -m 10 https://mentible.com/ 2>&1 | grep -iE "expire|HTTP|location"
```

Success = no "certificate expired" and a `302` to `https://mambakkam.net/mentible`.

## Choices you can change

- **Destination** — currently the landing page (`/mentible`). Switch to the app
  (`/app/mentible/`) by editing `destination` in `firebase.json` if you'd rather drop
  visitors straight into the product.
- **Redirect type** — currently **302 (temporary)** on purpose: 301s are aggressively
  cached by browsers and hard to undo while the "revive vs retire" decision is still
  open. Switch to **301 (permanent)** once `mentible.com` is settled as the front door.
