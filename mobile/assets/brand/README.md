# Brand assets — Mentible

Candidate product logos (mark + "Mentible" wordmark). SVG is the source of
truth; the PNGs are transparent-background exports at 1200×1240.

| File | Concept |
|---|---|
| `mentible-growing-mind.{svg,png}` | "M" over an open book with a green "growing mind" tree — tagline *AI-Driven Self-Learner* |
| `mentible-pathway.{svg,png}` | Ascending pathway of learning steps (book → chat → video → compass) — tagline *Self-Learner Journey* |

### Gemini-generated concept set (`*-gemini.png`)

A six-up exploration generated with Gemini. **Raster only** (no SVG source),
469×384, on a light card background (not transparent). Wordmark reads "MENTIBLE"
with an *I*. Concept candidates for review — **not production-ready** (need a
text-free, transparent, higher-res redraw before any real use).

| File | Concept | Tagline |
|---|---|---|
| `mentible-growing-mind-gemini.png` | Tree-in-book "M" | *AI-Driven Self-Learner* |
| `mentible-guiding-light-gemini.png` | Lamp | *Guided Learning Hub* |
| `mentible-digital-spark-gemini.png` | Pencil / comet | *AI-Assisted Study* |
| `mentible-folded-m-gemini.png` | Folded-"M" monogram | *Modern Education Platform* |
| `mentible-mark-m-gemini.png` | 3-D "M" mark | — |
| `mentible-pathway-gemini.png` | Pathway | *Self-Learner Journey* |

### Text-free mark extracted from the Gemini growing-mind concept

Transparent, **text-free** crops of just the tree-in-book "M" glyph, pulled from
`mentible-growing-mind-gemini.png` (background keyed out; wordmark/tagline/header
removed). **Upscaled from a 469×384 raster — soft at large sizes.** Good for an
in-app hero or icon review; for a crisp store/launcher icon, redraw as vector
(cf. the SVG-sourced `mentible-growing-mind.svg`, a different rendition).

| File | Size | Use |
|---|---|---|
| `mentible-mark-growing-mind.png` | 224×214 | tight transparent mark |
| `mentible-icon-1024.png` | 1024×1024 | square, centered, ~12% safe margin — drop-in for `assets/icon.png` etc. (see below) |

### Radiant recolor family (derived from `mentible-icon-1024.png`)

All recolored/relit from `mentible-icon-1024.png` (which is **unchanged** — keep
it as the original). The recolor segments the mark and applies per-region
luminance ramps so the original shading/glow carries over:

- **leaves → green** (`#2faa5d`/`#54d488`, matching `mentible-growing-mind.svg`)
- **trunk + branches → brown** (`#724321`→`#a3713c`)
- **book → teal** (kept), with its outline **sharpened** (the radiance glow had softened it)
- **M → red-orange** (`#d2400c`→`#f66a22`) in the `redorange*` files; teal in `radiant.png`; bright orange in `radiant-orangeM.png`

The "radiance" pass = saturation/brightness boost + a soft screen-blended bloom
on the highlights. The **canonical mark is `mentible-icon-1024-redorange.png`**
(transparent); the Expo assets below were generated from it.

| File | Size / bg | M color | Notes |
|---|---|---|---|
| `mentible-icon-1024-radiant.png` | 1024, transparent | teal | radiant + green leaves / brown tree |
| `mentible-icon-1024-radiant-orangeM.png` | 1024, transparent | bright orange | earlier orange exploration |
| `mentible-icon-1024-redorange.png` | 1024, transparent | red-orange | **canonical mark** — source for the icon set |
| `mentible-icon-1024-redorange-white.png` | 1024, white | red-orange | full-bleed white (e.g. iOS-style preview) |
| `mentible-lockup-redorange-white.png` | 1024×~995, white | red-orange | mark + "Mentible" (DejaVu Serif Bold, teal) + *Author Yourself* (Z003 cursive, red-orange) |
| `mentible-lockup-redorange-transparent.png` | 1024×~994, transparent | red-orange | same lockup, transparent (teal wordmark is low-contrast on dark surfaces — needs a light-wordmark variant for dark backdrops) |

**Live Expo assets** (in `mobile/assets/`, generated from the canonical mark):
`icon.png` (full-bleed white, mark ~78%), `adaptive-icon.png` (transparent
foreground, mark in Android's central ~66% safe zone), `favicon.png` (196,
transparent), `splash.png` (the transparent lockup). `app.json` `splash` and
`android.adaptiveIcon` `backgroundColor` were set to `#ffffff` so the
light-designed mark sits on its intended backdrop (the app is otherwise dark
themed — revert to `#1e1b4b` if a dark splash is preferred).

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
