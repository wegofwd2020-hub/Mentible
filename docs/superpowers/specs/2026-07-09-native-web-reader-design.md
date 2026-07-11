# Native Web Reader — Design Spec

**Date:** 2026-07-09
**Status:** Approved (brainstorm)
**Implements:** the "graduate B in place" decision from the web-native-reader spike
(`spike/web-native-reader`, commit `4d0e8c7`). Turns the throwaway spike into a
production web reader that renders book content into the real DOM instead of a
sandboxed iframe.
**Amends:** nothing formally; supersedes the web branch of `LessonRenderer.tsx`
behind a flag. Native (Android) is unchanged.

## Why

The spike proved — with measurements on a live page — that rendering a topic into
the real DOM breaks capability ceilings the iframe cannot: whole-page text
selection (5,481 chars as one range), browser find-in-page (text lives in
`document.body`), real semantic headings (a11y + future SEO), the app's own
fonts/theme flowing into the content, and no CDN needed for prose. DOMPurify
stripped all scripts/handlers, so the no-iframe path is safe. The one gap: the
spike rendered bare HTML (h1 in the body font, no bespoke styling) and didn't
handle math/diagrams/quizzes. This spec closes that gap to full parity.

The iframe reader stays — it remains the **native (Android)** renderer via
`react-native-webview`, and the **web fallback**. This is additive on web behind a
flag until parity is verified, then the web default flips.

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| D1 | **Flag-gated until parity, then flip.** Build the native web reader behind a web-only flag while the iframe stays the web default. Reach full parity on real books, verify, then flip the flag so native is the web default. The iframe path is retained for Android and as a web fallback. No user-visible regression at any point. **Flip gate (added 2026-07-10):** because v1 ships *static* quiz reveal (D6), flipping the flag before interactive reveal lands would itself be a regression — so **the flip is gated on the interactive-reveal fast-follow**, not on v1. v1 = build + verify behind the flag, flag stays off. |
| D2 | **Lazy-load Mermaid per topic.** `marked` / `DOMPurify` / `KaTeX` bundle normally (~400KB). Mermaid (~3MB) loads via dynamic `import()` only when a topic actually contains a ```mermaid block. Prose-only topics never pay for it; once a diagram topic is opened, diagrams are offline-capable. |
| D3 | **Web-only.** The native renderer is a `.web` path. `Platform.OS !== "web"` keeps the `react-native-webview` renderer untouched — `DOMPurify`/`marked`/`mermaid` must never be imported on native. |
| D4 | **Sanitization is mandatory and load-bearing.** With no iframe boundary, all content (model- and, via ADR-027, other-user-authored) is untrusted. DOMPurify runs over every rendered fragment. The config must permit KaTeX output (MathML/SVG spans) and Mermaid output (SVG) while stripping `<script>`, event handlers, and `javascript:`/`data:` URLs. The spike's security tests (0 scripts, 0 `onerror`) become the parity gate for every content type. |
| D5 | **Parity is defined by the existing iframe.** The native reader renders the same content types the iframe does — lesson, tutorial, quiz sets, experiment, plus ```mermaid and ```svg fences and KaTeX math — and ports `contentHtml.ts`'s stylesheet so the look matches or beats it. |
| D6 | *(confirmed 2026-07-10)* **Quiz reveal is static in v1.** Answer + explanation always visible; no in-page JS, no React reveal state. Interactive reveal (a `QuizBlock` with click-to-reveal) is the fast-follow that gates the D1 flip. |
| D7 | *(confirmed 2026-07-10)* **Model-authored ```svg is sanitized strictly, then verified on real books.** DOMPurify's SVG profile is the boundary — stricter than the iframe's regex `<script>` strip. Because animated SVG is a shipped product capability, the build includes an explicit verification task: render every diagram/SVG topic in both default-library books under the flag and diff against the iframe. If sanitization strips animation constructs (`<animate>`, `<animateTransform>`, `<set>`, `<animateMotion>`), allowlist those **tags only** — they carry no script capability. Never allowlist `on*` handlers, `<script>`, or `<foreignObject>` to fix a render. |

## Architecture

```
mobile/app/book/topic/[bookId]/[topicId].tsx   ─┐  flip points: choose renderer
mobile/app/book/shared/[id].tsx                 ─┘  by flag + Platform

           chooses ────────────────────────────────────────────
                     │                                          │
   NativeTopicReader (web, flag on)              TopicRenderer (iframe; native + web default/fallback)
   mobile/src/reader/NativeTopicReader.web.tsx   mobile/src/components/LessonRenderer.tsx  (unchanged)
                     │
                     ├── renderTopicToSafeHtml(topic)   mobile/src/reader/renderContent.ts
                     │      lesson + tutorial + quiz + experiment → marked → sanitize
                     │      (pure, web-only: imports marked + DOMPurify)
                     │
                     ├── useKatex(ref)     renders $…$ / $$…$$ on the mounted node
                     └── useMermaid(ref)   dynamic-imports mermaid ONLY if the node has .mermaid
```

- **`renderContent.ts`** — pure, web-only. `renderTopicToSafeHtml(topic: GeneratedTopic): string`
  ports `contentHtml.ts`'s per-type render logic (lesson/tutorial/quiz/experiment)
  and its ```mermaid / ```svg handling, then returns a single DOMPurify-sanitized
  fragment. No React, no I/O — unit-testable in plain jest.
- **`NativeTopicReader.web.tsx`** — the component. Injects the sanitized fragment
  via `dangerouslySetInnerHTML`, applies the ported stylesheet (scoped to the
  reader container), and runs the KaTeX and Mermaid post-passes on the node.
- **`readerFlag.ts`** — `USE_NATIVE_WEB_READER = Platform.OS === "web" && process.env["EXPO_PUBLIC_NATIVE_READER"] === "1"` (mirrors `IS_DEMO`). The flip in D1 is: change this default. Until then the flag is off, so nothing user-visible changes.

### Sanitization (D4 — the crux)

DOMPurify config is the security boundary now. Requirements:
- **Strip:** `<script>`, all `on*` event handlers, `javascript:` URLs, `<iframe>`,
  `<object>`, `<embed>`, `<form>`.
- **Keep:** the HTML marked emits; KaTeX's output (`<span class="katex">…`, MathML);
  Mermaid's rendered `<svg>`. Mermaid runs *after* the DOMPurify pass and writes into
  the live DOM, so our sanitizer never inspects its output — its **input** (the
  ```mermaid source text) is untrusted, so it is escaped as text until Mermaid renders
  it, and Mermaid is configured `securityLevel: "strict"`. Under strict, Mermaid still
  emits `<foreignObject>` HTML labels but runs its **own** internal DOMPurify over their
  contents (stripping handlers, `<script>`, `javascript:` URLs) and disables click
  callbacks — so the safety of a hostile diagram source rests entirely on that internal
  pass. **Verified 2026-07-11:** an adversarial 9-vector test in real headless Chrome
  (`mobile/security/run-mermaid-xss-security.mjs`, CI job `mobile-mermaid-xss`) confirms
  mermaid@10.9.6 neutralizes every vector; it goes red if `securityLevel` is weakened.
  A defence-in-depth re-sanitize of Mermaid's output is **not** viable — DOMPurify blanks
  the xhtml label text ("Start"/"Choice"/"End" → empty), breaking the diagram.
- **`<svg>` from ```svg fences is untrusted** (model-authored) and MUST go through
  DOMPurify with SVG profile — scripts and event handlers stripped (the spike
  confirmed DOMPurify does this). The current iframe path only regex-strips
  `<script>` from these; the native path is *stricter*.

The parity gate: for each content type, a test asserts a malicious payload
(`<img onerror>`, `<svg onload>`, `javascript:` link, `<script>`) produces zero
executable artifacts in the sanitized output.

## Content types (parity checklist)

| Type | Source shape | Render |
|---|---|---|
| Lesson | `sections[{heading, body_markdown}]`, synopsis, objectives, takeaways | marked per field |
| Tutorial | `sections[]`, `common_mistakes[]` | marked |
| Quiz sets | `questions[{question_text(md), options[], correct_option, explanation(md)}]` | marked + option list; reveal-answer interaction (see Risks) |
| Experiment | `materials[]`, `safety_notes[]`, `steps[]`, `questions[]`, `conclusion_prompt` | marked |
| Math | `$…$` / `$$…$$` inside any markdown | KaTeX post-pass |
| Mermaid | ```mermaid fence | lazy Mermaid post-pass |
| Animated SVG | ```svg fence | inline after SVG-profile sanitize |

## Files

```
NEW  mobile/src/reader/renderContent.ts             pure web-only: topic → sanitized HTML
NEW  mobile/src/reader/NativeTopicReader.web.tsx     component: inject + katex + lazy mermaid
NEW  mobile/src/reader/NativeTopicReader.tsx         native stub (never renders; keeps imports safe)
NEW  mobile/src/reader/readerStyles.ts               ported contentHtml.ts CSS, scoped
NEW  mobile/src/constants/readerFlag.ts              USE_NATIVE_WEB_READER
NEW  mobile/__tests__/reader/renderContent.test.ts   render + SECURITY parity per content type
NEW  mobile/__tests__/reader/NativeTopicReader.test.tsx  flag/branch + no-script render
EDIT mobile/app/book/topic/[bookId]/[topicId].tsx    pick renderer by flag
EDIT mobile/app/book/shared/[id].tsx                 pick renderer by flag
EDIT mobile/package.json                             marked, dompurify, katex (mermaid dynamic)
DELETE mobile/app/reader-lab.tsx, mobile/src/reader-lab/  the spike (graduated)
```

Native `LessonRenderer.tsx` / `contentHtml.ts` are **unchanged** — still the
Android renderer and the web fallback.

## Testing

- `renderContent.test.ts` — for EACH content type: (1) renders expected structure;
  (2) **security**: a malicious payload in that field yields no `<script>`, no
  `on*` handler, no `javascript:` URL in the output. This is the load-bearing suite.
- `NativeTopicReader.test.tsx` — flag off → iframe path; flag on (web) → native
  path; native platform → never imports DOMPurify/mermaid.
- Mermaid lazy-load: assert the module is not imported for a diagram-free topic.
- No live CDN/network in tests (KaTeX/Mermaid post-passes are effect-guarded and
  mocked). Consistent with the repo's "never hit external APIs in CI".
- Manual: drive the flag-on web reader on real books (both default-library books),
  confirm parity vs the iframe on the same topics, confirm find-in-page + selection.

## Risks

1. **Quiz interactivity.** *(resolved — D6.)* The iframe quiz reveals answers via
   in-page JS; the native path has no in-frame script. v1 ships static reveal.
   Because that is a regression relative to the iframe, the D1 flag flip is gated on
   the interactive-reveal fast-follow, so no web user ever sees the downgrade.
2. **DOMPurify vs KaTeX/Mermaid/animated-SVG output.** Too-strict config blanks
   math/diagrams/animations; too-loose re-opens XSS. The per-type security tests +
   the D7 real-book verification pass are the guard. Mermaid input stays
   escaped-until-rendered; `securityLevel: strict`. Animation-tag allowlisting (D7)
   is the *only* sanctioned loosening.
3. **Mermaid bundle.** Even lazy, a diagram topic pulls ~3MB. Acceptable per D2;
   logged so it's a known cost, not a surprise.
4. **Parity drift.** `contentHtml.ts` (iframe) and `renderContent.ts` (native) now
   both render the same data. Until the iframe is retired they can diverge. Mitigate:
   the parity test suite runs the same fixtures through both where practical, and the
   flip (D1) is the trigger to consider retiring the iframe on web.

## Out of scope

- Retiring the iframe entirely (it stays for Android + web fallback).
- SEO/SSR (that was the Next.js-repo thesis, explicitly not chosen).
- Interactive quiz reveal (fast-follow after v1 static reveal).
- Any backend/auth/billing change.

---

## D7 verification (2026-07-10)

Run against the real app (`EXPO_PUBLIC_NATIVE_READER=1 npx expo start --web`), plus a
headless pass over the whole bundled corpus. **Result: D7 satisfied. No sanitization
fallback (spec D7's animation-tag allowlist extension) was needed beyond the three tags
already allowlisted in `sanitize.ts`.**

### Headless pass — all 30 topics of `claude-certified-architect-foundations`

Every topic pushed through the real `renderTopicToSafeHtml`:

| Measure | Result |
|---|---|
| `svg` fences in → `<svg>` elements out | **26 → 26** (none dropped) |
| `<animate>` surviving | **47** |
| `<animateMotion>` surviving | **15** |
| `<style>` (CSS keyframes) inside SVG | **1** |
| `.mermaid` blocks | **99** |
| `$$` display-math delimiters | **118** |
| `<script>` in output | **0** |
| event-handler attributes in output | **0** |
| `<use>` / `<mpath>` / `xlink:href` in source | **0 / 0 / 0** |

The last row settles the reviewer's concern that `FORBID_ATTR: ["xlink:href"]` strips
legitimate `<use xlink:href="#id">` and `<mpath>` references: this corpus contains none.
`<animateTransform>` and `<set>` are allowlisted but unused by these books.

### Browser drive — topic `ts-1-6` (1 animated SVG, 5 Mermaid diagrams, 12 display-math blocks)

Flag ON:

- `iframeCount: 0`; `.mentible-reader` mounted; 0 `<script>`, 0 event-handler attributes.
- Real semantic DOM: `h1` + 11 `h2`, 82 `<p>`, 58 `<li>`.
- **Whole-topic selection: 27,067 characters in a single range** (the iframe trapped
  selection inside the frame).
- **Browser find-in-page works** — topic text is in `document.body`.
- 5/5 Mermaid diagrams rendered to `<svg>`, dark theme, labels legible.
- 22 KaTeX nodes, 6 `.katex-display` blocks rendered.
- **The animated SVG animates.** `<animate attributeName="opacity" values="1;0.2;1"
  dur="2s" repeatCount="indefinite">` survived sanitization intact; driving the SVG clock
  to t=0/1/2 yields computed opacity `1` / `0.2` / `1`.
- Reader scrolls (`scrollHeight` 19497 > `clientHeight` 480), so the ported
  `overflow-y: auto; height: 100%` resolves correctly inside the react-native-web
  `View` chain. No flex-height regression.
- Console clean: no errors, no KaTeX/Mermaid warnings.

Flag OFF (default, i.e. what ships):

- `iframeCount: 1`, `sandbox="allow-scripts"`, delivered via `srcDoc`, `src` null,
  **no `allow-same-origin`**. `.mentible-reader` absent. Last week's token-exfil fix intact.

### Findings recorded, not fixed here

1. **Mermaid's output is not covered by our sanitizer.** `mermaid.run()` writes into the
   DOM *after* the DOMPurify pass, so `SANITIZE_CONFIG`'s `FORBID_TAGS: [foreignObject]`
   never sees it — and Mermaid emits **78 `<foreignObject>`** nodes for HTML labels. On
   this corpus their contents are only `br/div/span`, with 0 scripts, 0 handlers, 0
   anchors, 0 `javascript:` URLs. Safety therefore rests on Mermaid's *own* internal
   DOMPurify under `securityLevel: "strict"` — which is exactly why D4 mandates strict
   mode. Worth an explicit adversarial test (feed a hostile ```mermaid source) before the
   D1 flip.
2. `securityLevel: "strict"` did **not** visibly degrade any of the 5 diagrams versus the
   iframe's `securityLevel: "loose"`.
3. The `<style>` element inside one SVG fence survives sanitization (DOMPurify's SVG
   profile keeps it), so its CSS-keyframes animation works.

### Known, accepted parity difference

An ordinary ` ```js ` code fence renders **escaped** in the native reader and **unescaped**
in the iframe (`contentHtml.ts` never escaped default fences — masked by the sandbox). The
native behaviour is the correct one. A topic whose code sample contains `<b>` will look
different between the two readers; this is a fix, not a regression.
