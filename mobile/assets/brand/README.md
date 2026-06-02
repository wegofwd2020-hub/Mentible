# Brand assets — Mentible

Candidate product logos (mark + "Mentible" wordmark). SVG is the source of
truth; the PNGs are transparent-background exports at 1200×1240.

| File | Concept |
|---|---|
| `mentible-growing-mind.{svg,png}` | "M" over an open book with a green "growing mind" tree — tagline *AI-Driven Self-Learner* |
| `mentible-pathway.{svg,png}` | Ascending pathway of learning steps (book → chat → video → compass) — tagline *Self-Learner Journey* |
| `mentible-growing-mind-gemini.png` | Gemini-generated take on the growing-mind concept (tree-in-book "M") — tagline *AI-Driven Self-Learner*. **Raster only** (no SVG source), 469×384, on a light card background (not transparent). Wordmark reads "MENTIBLE" with an *I*. Concept candidate, not production-ready. |

> Brand note: "Mentible" is **provisional pending trademark clearance** (see the
> rebrand/ADR memory). Don't ship to a store under this name until cleared.

## Promoting one to the app

These are full logos (they include the wordmark), so they are **not** drop-in
launcher icons. To use one:

- **App launcher / splash / favicon** — produce a **square, text-free** crop of
  just the mark (e.g. 1024×1024), save as `assets/icon.png`,
  `assets/adaptive-icon.png` (foreground), `assets/splash.png`,
  `assets/favicon.png`, then wire them in `app.json` under
  `expo.icon`, `expo.android.adaptiveIcon.foregroundImage`, `expo.splash.image`,
  `expo.web.favicon`.
- **In-app hero** — the Query screen renders the wordmark as text
  (`BRAND_NAME`/`BRAND_TAGLINE` in `app/(tabs)/index.tsx`). To show the logo
  image instead, render one of these via `expo-image`/`Image` there (the full
  logo already contains the wordmark, so drop the text lines).

Original drop: `~/Downloads/mentible_recolored.zip` (also had opaque
white-background PNGs).
