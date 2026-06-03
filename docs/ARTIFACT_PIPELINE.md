# Artifact pipeline — content → EPUB3 / PDF / MOBI → reader vs print

Companion to **ADR-004**. ADR-004 records the *decisions*; this doc shows the
*flow* and the *per-format mechanics*, with a worked example so the
interactive-vs-static degradation is concrete.

> One canonical source. Many compile targets. Interactivity is a property of
> **EPUB3 + our reader**, not of the content.

---

## The flow

```
                 ┌─────────────────────────────────────────────┐
   AUTHORING     │  Canonical source  (book.json)               │
   (this repo,   │  subjects → topics → {lesson, tutorial,      │
    online,      │                       quizSets, experiment}  │
    BYOK)        └───────────────┬─────────────────────────────┘
                                 │  COMPILE  (server-side, no key needed)
                                 │  1. markdown → XHTML
                                 │  2. KaTeX → MathML        ← baked in, no CDN
                                 │  3. Mermaid → SVG         ← baked in, no CDN
              ┌──────────────────┼─────────────────────┐
              ▼                  ▼                       ▼
        ┌───────────┐      ┌───────────┐          ┌───────────┐
        │  EPUB 3   │      │   PDF     │          │  MOBI     │
        │ + interactive    │ textbook  │          │  (later)  │
        │   quiz JS │      │ layout    │          │  static   │
        └─────┬─────┘      └─────┬─────┘          └─────┬─────┘
              │                  │                      │
              ▼                  ▼                      ▼
      ┌───────────────┐    ┌───────────┐         ┌───────────┐
      │  OUR READER   │    │  PRINT or │         │  Kindle / │
      │  (free, off-  │    │  any PDF  │         │  generic  │
      │  line): full  │    │  viewer   │         │  reader   │
      │  interactive  │    └───────────┘         └───────────┘
      │  + progress   │
      └───────────────┘
   generic EPUB readers also open the EPUB3 — but static (JS off)
```

---

## Compile stage (shared by every target)

The compile step is **deterministic and key-free** — it transforms already-generated
content; it does *not* call Anthropic. It runs server-side (ADR-004 D8). Seeded by
the existing `mobile/src/components/contentHtml.ts` HTML/CSS.

| Step | From | To | Why |
|---|---|---|---|
| Markdown render | `body_markdown`, etc. | XHTML | EPUB3 requires well-formed XHTML |
| Maths | `$…$` / `$$…$$` (KaTeX) | **MathML** | native in EPUB3; no runtime JS/CDN |
| Diagrams | ` ```mermaid ` blocks | **SVG** | renders anywhere, offline, print-safe |
| Assets | — | packaged in the artifact | self-contained, no network |

After this stage, **display needs zero JS and zero network**. The only script that
ever ships is the optional interactive-quiz layer in the EPUB3 build.

---

## Per-format mechanics

### EPUB3 (flagship)
A zipped package: `mimetype` + `META-INF/container.xml` + content XHTML (one per
chapter/topic) + CSS + pre-rendered SVG assets + **OPF manifest** + **nav.xhtml**
(TOC). Quizzes ship twice-capable:
- **Interactive** (our reader): scripted content document — choose option → reveal
  correct + explanation; attempts/score recorded by the reader's local store.
- **Static fallback** (generic reader, JS off): the same quiz renders as a plain
  answer key.

A manifest marker identifies the book as "ours" so the reader knows to enable the
interactive overlay (exact mechanism = ADR-004 open question).

### PDF (print path) — textbook compilation (ADR-004 D5)
Rendered for fixed layout (headless Chromium over the compiled XHTML + a print
stylesheet). Document order:
1. **Front matter + TOC** with **page-number index**.
2. **Chapters** — each topic's lesson + tutorial, in reading order.
3. **Quizzes section** — every chapter's quiz questions, grouped, labelled by chapter
   (questions only, no inline answers).
4. **Answers section** — correct answer + explanation for each question, by chapter.

### MOBI (later / maybe)
Converted from the finished EPUB (Calibre/kindlegen). Static, image-based maths.
Out of near-term scope.

---

## Interactive-vs-static matrix

| | Maths | Diagrams | Quiz question | Quiz answer | Score/progress |
|---|---|---|---|---|---|
| **Our reader (EPUB3)** | MathML, offline | SVG, offline | interactive choices | revealed on answer + explanation | **tracked locally** |
| Generic EPUB reader | MathML, offline | SVG, offline | static list | shown (answer key) | none |
| PDF / print | laid out | laid out | in **Quizzes** section | in **Answers** section | none |

---

## Artifact types & media (extension point — PLACEHOLDER)

> **Status: reserved, not built.** Today the pipeline emits **EPUB3** and **PDF**,
> carrying **text, figures (SVG), and math (MathML)**. Publishing is broader than
> that — artifacts can carry audio, video, and interactive media, and there are
> several distribution formats beyond ours. This section names that space so it's
> a **deliberate extension point** rather than something bolted on later. The rows
> marked **PLACEHOLDER** are *not implemented* and there is **no code seam yet**
> (this is documentation only); fill each in when the roadmap reaches it.

### Format × status × media

| Artifact | Status | Media carried | First-build notes |
|---|---|---|---|
| **EPUB3 (reflowable)** | ✅ shipping | text · image · math | flagship; interactive quiz layer in our reader |
| **PDF (screen)** | ✅ shipping | text · image | fixed layout; *not* print-ready PDF/X (see publishing §6) |
| **MOBI / Kindle (AZW)** | 🔜 planned (ADR-004) | text · image (static math) | convert from finished EPUB; static |
| **Enhanced EPUB** | 🟡 PLACEHOLDER | + audio · video | media-embedded EPUB3; **EPUB Media Overlays** for read-along; big size/licensing/a11y implications |
| **Audiobook (M4B / DAISY audio)** | 🟡 PLACEHOLDER | audio (+ chapter marks) | needs narration (TTS or human), chapter timing; DAISY for accessible audio |
| **Interactive HTML / web bundle** | 🟡 PLACEHOLDER | interactive · text · image · math | self-hosted package; richer widgets than EPUB JS; needs a static fallback |
| **DAISY (accessible)** | 🟡 PLACEHOLDER | text · audio | the accessible-publishing format; overlaps the EAA work (publishing §7) |
| **SCORM / xAPI package** | 🟡 PLACEHOLDER | interactive · text | only if we ever target LMS distribution; likely out of scope |

### Media kinds (vocabulary)

A single canonical `book.json` can, in principle, carry these media kinds; each
compile target supports a subset. This vocabulary should line up with the
accessibility **access modes** the OPF already emits (see
[`PROFESSIONAL_PUBLISHING.md`](PROFESSIONAL_PUBLISHING.md) §7 and
`compiler/src/epub.ts → accessibilityMeta`):

| Media kind | Example formats | Today | a11y access mode | The new obligation it brings |
|---|---|---|---|---|
| `text` | (X)HTML | ✅ | textual | — |
| `image` / diagram | SVG, PNG, JPEG, **GIF** | ✅ (static) | visual | alt text / described diagrams. **Animated GIF** adds motion → declare a `flashing`/`motionSimulation` hazard if applicable, and prefer a pausable format (GIF can't be paused) |
| `math` | MathML | ✅ | textual (+visual) | already accessible as MathML |
| `audio` | MP3, M4A/AAC | 🟡 placeholder | auditory | **transcript**; synced text for read-along |
| `video` | **MP4 (H.264/AAC)**, WebM | 🟡 placeholder | auditory + visual | **captions + audio description + transcript** |
| `music` (symbolic) | **MIDI**, MusicXML | 🟡 placeholder | auditory (+ textual score) | **notation/score + text description** (not just an audio transcript — MIDI is note events, not sampled sound); playback control |
| `interactive` | HTML/JS widgets | 🟡 placeholder | (varies) | **static fallback**; keyboard/AT operability |

### When we build one (stub checklist)

For each new artifact/media type, decide and document:

- [ ] **Source model** — what new fields (if any) the canonical `book.json`
      gains, and whether it's additive (it must not break existing books).
- [ ] **Compile path** — how the deterministic, key-free compile stage produces
      it (new renderer? external tool like Calibre/ffmpeg? TTS provider?).
- [ ] **Media generation cost & rights** — audio/video may need a provider and
      have licensing/cost implications (cf. BYOK economics, ADR-005).
- [ ] **Accessibility** — the obligation column above (transcripts, captions,
      fallbacks) is **mandatory**, not optional (EAA — publishing §7).
- [ ] **Metadata** — extend the OPF/accessibility metadata to declare the new
      access modes and features.
- [ ] **Distribution** — which channels accept it (publishing §8) and its
      identifier rules (a distinct ISBN per format — publishing §4).
- [ ] **Reader support** — whether our free reader (ADR-004) renders it or it's
      a standalone artifact.

> If/when one of these graduates from placeholder to planned, promote it to a
> first-class section under **Per-format mechanics** and, if it changes the
> product direction, record the decision in an ADR (cf. ADR-004).

---

## Worked example — one topic, two destinations

Source (canonical `book.json`, abbreviated):

```jsonc
{
  "topicId": "…",
  "title": "Kinematics",
  "lesson": { "topic": "Kinematics", "sections": [
    { "heading": "Velocity", "body_markdown": "Average velocity is $v=\\frac{\\Delta x}{\\Delta t}$." }
  ] },
  "quizSets": [ { "questions": [ {
    "question_text": "If $\\Delta x = 10\\,m$ over $2\\,s$, what is $v$?",
    "options": [ {"option_id":"A","text":"5 m/s"}, {"option_id":"B","text":"20 m/s"} ],
    "correct_option": "A",
    "explanation": "$v = 10/2 = 5\\,m/s$."
  } ] } ]
}
```

**In our reader (interactive EPUB3):**
```
Kinematics
  Velocity — Average velocity is  v = Δx/Δt        ← MathML, offline

  Quiz
  If Δx = 10 m over 2 s, what is v?
   ( ) A. 5 m/s        ← tap to answer
   ( ) B. 20 m/s
        ↓ (taps A)
   (•) A. 5 m/s  ✓ correct
       Explanation: v = 10/2 = 5 m/s
  [ recorded: 1/1 this quiz · book 42% complete ]      ← local, offline
```

**In the print PDF (same source):**
```
p.12   Chapter 3 · Kinematics
         Velocity. Average velocity is v = Δx/Δt.
 …
p.88   Quizzes
         Chapter 3 — Kinematics
         Q1. If Δx = 10 m over 2 s, what is v?
              A. 5 m/s    B. 20 m/s
 …
p.140  Answers
         Chapter 3 — Kinematics
         Q1. A (5 m/s).  v = 10/2 = 5 m/s.
```

Same content, same maths — only the *interaction* differs by destination.

---

## What this means for this repo (authoring)

- The in-app topic reader we already ship (`TopicReadList` → topic WebView) becomes
  an **author preview** ("see roughly what you made"), *not* the shipping reader.
- The next build-out is the **compile pipeline** (ADR-004 phasing 1–2): canonical
  `book.json` → pre-rendered, CDN-free XHTML → a valid EPUB3. Everything else
  (interactive layer, PDF layout, the reader app) stacks on that foundation.
