# Short-Form Publishing Studio — Requirements

**Status:** Draft / exploratory · **Date:** 2026-07-27
**One-liner:** A product surface that turns an idea (or an existing asset — a diagram, a lesson, a book excerpt) into a piece of **short-form publishing material** — a social post, a marketing banner, an animated card, or an audio clip — ready to download and post.

> Framing note: this is *not* Mentible's book/lesson authoring core. It is an adjacent surface that reuses the same engine (scoped LLM generation + the Chromium rasterizer + animated-SVG + the media pipeline). The real question below is **what's genuinely new work vs. what Mentible already has.**

---

## 1. Why / motivating example

Today, producing a LinkedIn post from a diagram is fully manual: hand-write copy, hand-edit the SVG title, shell Chromium to rasterize a PNG, upload. Every step is a human in the loop with no reuse. The product automates that loop and extends it from *static text + image* to *animated* and *audio* short-form.

---

## 2. Output types (the matrix)

The product is defined by the **cross-product of {format} × {platform target}**. This matrix is the spec — everything downstream (renderer, size, limits) derives from it.

| Format | What it is | Primary artifact | Hard part |
|---|---|---|---|
| **Text post** | Platform-native copy (hook, body, hashtags, CTA) | plain text / rich text | scoping the voice + length per platform |
| **Static banner / card** | 1–N image(s), branded | PNG/JPG at platform aspect ratio | layout engine + brand kit |
| **Carousel** | Ordered set of banner frames | N × PNG (or PDF) | narrative sequencing across frames |
| **Animated card** | Motion graphic (title reveal, diagram build-up) | **GIF or MP4** | frame capture + video encode (real cost) |
| **Audio clip** | Voiceover / narrated summary | **MP3/AAC** | TTS provider + cost + licensing |
| **Video (A+V)** | Animation + audio combined | MP4 | mux audio track onto animation (ffmpeg) |

Platform targets (each pins dimensions + char/hashtag limits): **LinkedIn, X/Twitter, Instagram (feed/story/reel), Facebook, YouTube (short/thumbnail), generic web banner (IAB sizes).**

---

## 3. Functional requirements

### FR-1 — Input / source
- Generate from a **prompt** (scoped, à la Mentible's 6-dimension IP: topic, audience, tone, length, format, platform).
- Generate from an **existing asset**: a Mentible book/lesson/topic, an uploaded image or SVG (like today's diagram), or pasted text.
- "Repurpose" flow: one source → several formats at once (post + banner + audio from the same idea).

### FR-2 — Brand kit
- A reusable **brand asset set**: palette, fonts, logo, handle, default hashtags, tone-of-voice preset.
- Applied automatically to every rendered artifact. (Mentible already carries a theme system — `mobile/src/constants/theme.ts` palettes — this generalizes it.)

### FR-3 — Generation
- LLM drafts copy scoped to the selected platform (length, hashtag count, CTA style, emoji density).
- LLM proposes visual layout / animation beats / a voiceover script as **structured output**, not free prose, so the renderer can consume it.
- Multiple variants per request (A/B), user picks.

### FR-4 — Render / export
- **Text:** copy-to-clipboard + `.txt`/`.md`.
- **Image:** render layout → PNG/JPG at exact platform pixel size, RGB, sane file weight.
- **Animated:** render timeline → GIF and/or MP4.
- **Audio:** TTS the script → MP3, with voice + pace selection.
- **A+V:** mux audio onto the animation → MP4.

### FR-5 — Preview + edit loop
- In-app preview at true aspect ratio before export.
- Edit copy, swap colors, re-time animation, re-voice audio — regenerate only the changed layer (don't re-run everything).

### FR-6 — Library / versioning
- Save generated pieces, re-open, re-export, track which source they came from.

### FR-7 — Provenance / disclosure
- Every artifact carries an **AI-generated** provenance marker (ties directly to the KDP AI-disclosure workstream, #336-A — same discipline: this content is AI-*generated*, label it).
- Optional visible watermark / handle.

### FR-8 — Distribution
- **MVP: download only** — the user posts it themselves (same stance as Mentible/KDP: we produce the artifact, no auto-submit).
- Later: optional direct-publish via platform APIs (OAuth per platform) — big scope, defer.

---

## 4. Pipeline / architecture

```
 idea | asset
      │
      ▼
 ┌─────────────┐   scoped prompt (platform + format + brand)
 │  SCOPING    │───────────────────────────────────────────┐
 └─────────────┘                                            │
      │                                                     ▼
      ▼                                             ┌───────────────┐
 ┌─────────────┐  structured plan                  │  BRAND KIT    │
 │ LLM GENERATE│  {copy, layout, beats, script} ◄──┤ palette/font/ │
 └─────────────┘                                   │ logo/tone     │
      │                                            └───────────────┘
      ▼
 ┌───────────────────── RENDER LAYERS ─────────────────────┐
 │  text     → string                                       │
 │  image    → HTML/SVG → Chromium screenshot → PNG/JPG     │  ← reuse coverRaster.ts / cover pipeline
 │  animated → animated SVG → frame capture → GIF/MP4       │  ← reuse animated-SVG (ADR); NEW: encode
 │  audio    → script → TTS provider → MP3                  │  ← NEW: TTS provider seam
 │  A+V      → ffmpeg mux(animation, audio) → MP4           │  ← NEW: ffmpeg
 └──────────────────────────────────────────────────────────┘
      │
      ▼
   preview → edit loop → export/download → (later) direct publish
```

---

## 5. Reuse vs. build (where the real work is)

### Already have (low new work) — reuse the engine
- **Scoped LLM generation** — the 6-dimension scoping IP + the `wegofwd-llm` seam (ADR-012) + hybrid managed/BYOK keys (ADR-005). Text + structured plans come nearly free.
- **SVG → PNG/JPG rasterization** — `compiler/src/coverRaster.ts` already screenshots SVG via headless Chromium (exactly what produced today's PNG). Banners = this + a layout template.
- **Animated visuals as animated SVG** — the LLM-emits-```svg` decision (memory: animated visuals = animated SVG, not paid text-to-video). Motion source is already free.
- **Theming** — `theme.ts` palettes generalize into the brand kit.
- **Provenance discipline** — the trust-manifest + KDP AI-disclosure thinking transfers directly.

### Genuinely NEW work (the cost centers)
1. **Layout engine for banners/carousels** — templated, brand-aware, multi-aspect-ratio. Non-trivial: text must fit boxes across sizes without overflow (we already hit overflow in the PPTX deck; same class of problem, harder because auto-generated).
2. **Animation → video encode** — animated SVG renders in a browser, but GIF/MP4 needs **frame-by-frame capture + encode** (Puppeteer screencast or per-frame screenshots → ffmpeg). This is the biggest new engineering lift. Timing/duration control from the LLM's "beats".
3. **Audio / TTS** — a **new provider seam**: pick TTS vendor(s), voice catalog, pacing, cost model. Managed-key cost + per-plan allowance (ADR-005 economics apply — audio minutes are metered spend). Licensing of voices.
4. **A/V mux** — ffmpeg dependency + pipeline (align audio length to animation length).
5. **Platform spec table** — dimensions, char limits, hashtag norms, safe-zones per platform; keep current as platforms change.
6. **Brand-kit management UI + storage.**
7. **Multi-format "repurpose" orchestration** — fan one source into N artifacts, each its own render path.
8. **Direct-publish (deferred)** — per-platform OAuth, API quirks, review/queue. Large; not MVP.

---

## 6. Non-functional
- **Cost-aware:** image render ≈ free (Chromium); **audio (TTS) and video (encode CPU) are the metered cost drivers** — gate behind plan allowance (ADR-005 D4/D18 fair-use cap logic reused as a cost lever).
- **Deterministic renders:** same plan → same pixels (needed for preview-then-export parity).
- **Fast enough:** static in seconds; animated/audio in "minutes" is acceptable (matches D12 latency posture).
- **Provenance non-optional** on every artifact (compliance + brand honesty).
- **Adults-only, minimal-PII** posture carries over unchanged.

---

## 7. Phasing (suggested)

| Phase | Deliverable | New work |
|---|---|---|
| **P1 — Static** | Prompt/asset → platform-scoped **text post + branded PNG banner**, download only | layout engine + brand kit + platform table |
| **P2 — Carousel** | Multi-frame carousels + repurpose (1 source → N formats) | sequencing + fan-out orchestration |
| **P3 — Animated** | Animated SVG → **GIF/MP4** | frame capture + ffmpeg encode |
| **P4 — Audio** | Script → **TTS MP3**; then **A/V mux** to MP4 | TTS provider seam + mux |
| **P5 — Publish** | Optional direct-to-platform posting | per-platform OAuth/API |

MVP = **P1**. It already delivers today's manual LinkedIn workflow, automated — and reuses ~80% existing engine.

---

## 8. Open questions
1. **Separate product, or a surface inside Mentible?** It shares the engine but serves marketers/creators, not learners. (Likely a sibling app under the same wegofwd shared-package family — ADR-019.)
2. **TTS vendor + voice licensing** — which provider, whose voices, cost per minute, managed vs. BYOK for audio?
3. **Video ceiling** — cap animated output length/resolution to bound encode cost?
4. **Brand kit scope** — single kit per user, or many (per client/campaign)?
5. **Where does provenance live** — visible watermark, embedded metadata, or both?

## 8b. Comparable products (landscape)

*As of early-2026 knowledge — verify live. Grouped by the slice of our scope each one occupies. No single player owns the whole matrix; that gap + our source-from-a-lesson/diagram angle is the wedge.*

### All-in-one design + AI (broadest overlap)
- **Canva (Magic Studio)** — text→image, banners, carousels, animations, Brand Kit, some video/voiceover. The 800-lb gorilla; covers most of P1–P3 for non-technical users.
- **Adobe Express (Firefly)** — same shape, Adobe assets/fonts, animation + basic audio.
- **Simplified**, **Predis.ai** — AI social-post copy + graphic + carousel + basic video in one flow.

### Social copy + scheduling (text-first)
- **Buffer (AI Assistant)**, **Hootsuite (OwlyWriter)**, **Later**, **Publer**, **Vista Social** — draft + schedule; light on rich visuals.
- **Typefully**, **Taplio** (LinkedIn-native), **AuthoredUp** — creator-focused post + carousel, strong on LinkedIn voice.

### Repurpose one source → many formats (our FR-1 "repurpose")
- **Repurpose.io** — pipe one asset to many channels.
- **OpusClip**, **Munch**, **Vizard** — long video → short clips.
- **Descript**, **Castmagic** — podcast/audio/transcript → social snippets (closest to "book/lesson → post").

### AI ad / banner creative
- **AdCreative.ai**, **Creatopy**, **Bannerbear**, **Placid**, **Templated** — branded banners/ads at multiple sizes. *(Bannerbear/Placid/Templated are API-driven render engines — architecturally the closest to our Chromium-rasterizer approach.)*

### Animated / short-form video
- **Steve.ai**, **Pictory**, **InVideo AI** — script/text → animated or stock-footage video.
- **Synthesia**, **HeyGen** — AI-avatar presenter video.
- **Remotion** — programmatic MP4 from React/HTML. *(Directly relevant: this IS the animation→frame-capture→encode lift from §5-item-2. If we build P3, this is the build-vs-adopt reference.)*

### Audio / TTS (our FR-4 audio)
- **ElevenLabs** (quality leader), **Play.ht**, **Murf**, **WellSaid**, **Descript Overdub** — script → voiceover MP3. These are candidate *providers* for our TTS seam, not just competitors.

### Carousel-specialists
- **Contentdrips**, **Postnitro**, **AuthoredUp** — LinkedIn/IG carousel templating.

### Landscape read
- **Nobody owns the full {text + banner + carousel + animated + audio + A/V} × repurpose matrix** well. Canva is closest but general-purpose and not source-driven.
- **The differentiator to defend:** *source-native generation* — a post/banner/animation/audio produced **from an existing Mentible lesson, book, or authored diagram**, staying on-brand, with the animated-SVG motion path and provenance baked in. Competitors start from a blank prompt; we start from owned knowledge content. That's the moat (ties to the multi-modal Personal Library north-star).
- **Build-vs-adopt flags:** TTS → adopt (ElevenLabs-class provider). Video encode → evaluate **Remotion** vs. custom Puppeteer+ffmpeg. Banner render → we already have it (Chromium), no need for Bannerbear/Placid.

## 9. Non-goals (MVP)
- Auto-posting to platforms (P5, deferred).
- Long-form video / full motion-graphics editor — this is *short-form templated* output, not After Effects.
- Stock media library / licensed music.
- Paid text-to-video model generation (the animated-SVG decision stands — motion is authored as SVG, not bought per-second).
