# Native Web Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render book topics into the real web DOM (no iframe) behind a web-only flag, at full parity with the existing iframe reader, so web readers get whole-page text selection, browser find-in-page, real semantic headings, and the app's own fonts.

**Architecture:** A new `mobile/src/reader/` module turns a `GeneratedTopic` into one DOMPurify-sanitized HTML fragment (`renderContent.ts`, built on `sanitize.ts` + `markdown.ts`), which a web-only React component (`NativeTopicReader.web.tsx`) injects via `dangerouslySetInnerHTML` and then post-processes with KaTeX and a lazily-imported Mermaid. The existing `TopicRenderer` in `LessonRenderer.tsx` becomes the single switch point: on web with the flag on it renders the native reader; otherwise the untouched iframe/WebView path. Nothing user-visible changes until the flag flips.

**Tech Stack:** TypeScript, React Native + Expo 53 (RN 0.79.6, metro web bundler), `marked@9.1.6`, `dompurify@3.4.11`, `katex@0.16.9`, `mermaid@^10.6.1` (new, dynamic-import only), Jest (`jest-expo` preset) + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-09-native-web-reader-design.md` (D1–D7).

---

## Global Constraints

These apply to **every** task. Each task's requirements implicitly include this section.

1. **Web-only (spec D3).** `dompurify`, `marked`, `katex`, and `mermaid` MUST NEVER be reachable from the native bundle. Enforced by the `.web.tsx` / `.tsx` platform-suffix pair — metro resolves `NativeTopicReader.web.tsx` on web and `NativeTopicReader.tsx` (a stub that imports none of them) on native. Never `require()` the reader module from a non-suffixed file.
2. **Sanitization is the security boundary (spec D4).** With no iframe, `sanitizeFragment()` is the only thing between untrusted content (model-authored, and other-user-authored via ADR-027 draft sharing) and the app origin — where the Supabase session and the BYOK LLM key live in `localStorage`. Every rendered fragment passes through it. Never widen the config to make a render work, except the animation tags explicitly sanctioned in spec D7.
3. **Never allowlist** `<script>`, `<foreignObject>`, `on*` event handlers, `javascript:` URLs, `<iframe>`, `<object>`, `<embed>`, or `<form>` — for any reason, including "the diagram won't render".
4. **Mermaid runs `securityLevel: "strict"`** and its input stays HTML-escaped text until Mermaid itself renders it.
5. **No live network in tests.** Per `CLAUDE.md`: "Never hit a live Anthropic, live Redis, or any external API in CI." KaTeX and Mermaid post-passes are effect-guarded and mocked.
6. **Quiz reveal is static in v1 (spec D6).** Answer + explanation always visible. No React reveal state, no in-page JS. Do not build interactive reveal in this plan.
7. **The flag stays OFF at the end of this plan (spec D1).** `EXPO_PUBLIC_NATIVE_READER` is unset by default. The flip is gated on the interactive-reveal fast-follow, which is out of scope here.
8. **`LessonRenderer.tsx`'s iframe/WebView internals and `contentHtml.ts` are not modified.** The only edit to `LessonRenderer.tsx` is adding the switch inside `TopicRenderer` (Task 8).
9. **Coverage gate:** `mobile/jest.config.js` enforces 60% global on branches/functions/lines/statements. Do not lower it.
10. **Commit after every task**, with the exact message given in that task's final step.

### Environment facts verified against this repo (do not re-derive)

| Fact | Consequence |
|---|---|
| `jest-expo` preset sets `haste.defaultPlatform: "ios"`, `platforms: [android, ios, native]` — **no `web`** | Jest will NEVER resolve `NativeTopicReader.web.tsx` from `"./NativeTopicReader"`. Tests MUST import the explicit path `@/reader/NativeTopicReader.web`. |
| `jest-expo`'s `testEnvironment` is `react-native-env.js` (node-like, **no `document`**) | Any test touching DOMPurify/KaTeX/Mermaid needs the `@jest-environment jsdom` docblock. `jest-environment-jsdom@29.7.0` is already installed. |
| In a DOM-less env `require("dompurify")` returns a **factory function**; `.sanitize` is `undefined` | Without the jsdom docblock the tests fail with `TypeError: DOMPurify.sanitize is not a function`, not a security bypass. |
| DOMPurify 3.4.11 `USE_PROFILES: {svg:true}` **strips** `<animate>`, `<animateTransform>`, `<set>`; **keeps** `<animateMotion>`, `<style>` | The bundled book's 26 animated-SVG figures need `ADD_TAGS` (spec D7). |
| DOMPurify 3.4.11 drops `attributeName="href"` / `"xlink:href"` on animation elements **even when the tag is allowlisted** | The `<animate>` href→`javascript:` XSS is not reopened by D7's allowlist. Pin this with a regression test. |
| DOMPurify parses as HTML: a bare `<circle>` **outside** an `<svg>` root is dropped | Always sanitize the whole fragment containing `<svg>…</svg>`, never inner SVG pieces. Write test fixtures wrapped in `<svg>`. |
| `mermaid` is **not** in `package.json` | Task 1 installs it. A dynamic `import()` still requires the package. |
| **RNTL renders through `react-test-renderer`, not a DOM.** Measured in this repo: effects run, but a host `ref.current` is **`null`** and nothing is ever inserted into `document`. | A component test **cannot** assert `document.querySelectorAll("script")` — it would pass vacuously. Assert props via `UNSAFE_root.findByType(...)`, exactly as `__tests__/components/LessonRenderer.test.tsx` already does. DOM behaviour is tested separately, against a real jsdom node, in `enhance.test.ts`. |
| Because `ref.current` is `null` under RNTL, the KaTeX/Mermaid effects no-op in component tests | This is why the post-passes live in `enhance.ts` (Task 7a) rather than inline in the component. |
| `LessonRenderer.tsx` does a **module-level** `require("react-native-webview")` and `jest-expo` defaults `Platform.OS` to `"ios"` | Any test of `TopicRenderer` must `jest.mock("react-native-webview", …)` and set `Platform.OS = "web"` — copy the preamble of `__tests__/components/LessonRenderer.test.tsx`. |
| In Jest, `@/reader/NativeTopicReader` resolves to the **native stub** (no `web` haste platform) | A flag-on `TopicRenderer` test must `jest.doMock` that path, or the stub throws. On the real web bundle metro picks `.web.tsx` — the stub never runs. |
| `katex/contrib/auto-render` resolves to `dist/contrib/auto-render.js` | Import it by that bare specifier. |
| `import "katex/dist/katex.min.css"` works in metro web but **not** in Jest | Task 1 adds a `\.css$` moduleNameMapper stub. |
| Both call sites render `<TopicRenderer topic={topic} />` — `app/book/topic/[bookId]/[topicId].tsx:14` and `app/book/shared/[id].tsx:8` | Switching inside `TopicRenderer` means **zero route edits**. |

### Deviations from the spec (approved — call out in the PR body)

- **The spec's "Files" block lists one `renderContent.ts`.** This plan splits it into `sanitize.ts` (the security boundary), `markdown.ts` (marked config + fences), and `renderContent.ts` (per-type composition). Rationale: the sanitizer deserves its own file, its own test suite, and its own reviewer gate — it is the thing that replaces the iframe.
- **The spec says EDIT both route files to pick the renderer.** This plan instead switches inside `TopicRenderer` (`LessonRenderer.tsx`). Rationale: DRY, the two call sites cannot drift, and any future `TopicRenderer` call site inherits the flag automatically. Net: fewer edits, one switch.

---

## File Structure

```
NEW  mobile/src/constants/readerFlag.ts               USE_NATIVE_WEB_READER
NEW  mobile/src/reader/sanitize.ts                    THE security boundary: DOMPurify config + sanitizeFragment
NEW  mobile/src/reader/markdown.ts                    marked renderer: md(), escapeHtml(), mermaid + svg fences
NEW  mobile/src/reader/renderContent.ts               GeneratedTopic → one sanitized HTML fragment
NEW  mobile/src/reader/readerStyles.ts                contentHtml.ts CSS, scoped to .mentible-reader
NEW  mobile/src/reader/enhance.ts                     DOM post-passes: KaTeX + lazy Mermaid, on a real node
NEW  mobile/src/reader/NativeTopicReader.web.tsx      inject sanitized html + call enhanceReaderNode
NEW  mobile/src/reader/NativeTopicReader.tsx          native stub — imports nothing web-only
NEW  mobile/__mocks__/styleMock.js                    jest stub for `import "…css"`
NEW  mobile/__tests__/reader/sanitize.test.ts         SECURITY matrix (jsdom)
NEW  mobile/__tests__/reader/markdown.test.ts         fences + escaping (jsdom)
NEW  mobile/__tests__/reader/renderContent.test.ts    per-content-type render + security (jsdom)
NEW  mobile/__tests__/reader/enhance.test.ts          real-DOM: katex ran, mermaid lazy, no script node
NEW  mobile/__tests__/reader/NativeTopicReader.test.tsx  tree shape + sanitized __html (props, not DOM)
NEW  mobile/__tests__/reader/readerFlag.test.ts       flag semantics
NEW  mobile/__tests__/components/TopicRenderer.switch.test.tsx  flag off → iframe
EDIT mobile/jest.config.js                            css moduleNameMapper
EDIT mobile/package.json                              + mermaid
EDIT mobile/src/components/LessonRenderer.tsx         TopicRenderer switch (only change)
DEL  mobile/app/reader-lab.tsx, mobile/src/reader-lab/  the graduated spike
```

---

### Task 1: Flag, dependencies, and Jest plumbing

Nothing else can be tested until Jest can load CSS imports and `mermaid` exists. This task carries all of it plus the flag.

**Files:**
- Create: `mobile/src/constants/readerFlag.ts`
- Create: `mobile/__mocks__/styleMock.js`
- Create: `mobile/__tests__/reader/readerFlag.test.ts`
- Modify: `mobile/jest.config.js` (moduleNameMapper)
- Modify: `mobile/package.json` (add `mermaid`)

**Interfaces:**
- Consumes: nothing.
- Produces: `USE_NATIVE_WEB_READER: boolean` from `@/constants/readerFlag`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/readerFlag.test.ts`:

```ts
// The flag is read at module load, so each case needs a fresh module registry.
function loadFlag(env: string | undefined, platformOS: string): boolean {
  let value = false;
  jest.isolateModules(() => {
    if (env === undefined) delete process.env["EXPO_PUBLIC_NATIVE_READER"];
    else process.env["EXPO_PUBLIC_NATIVE_READER"] = env;
    jest.doMock("react-native", () => ({ Platform: { OS: platformOS } }));
    value = require("@/constants/readerFlag").USE_NATIVE_WEB_READER;
  });
  return value;
}

describe("USE_NATIVE_WEB_READER", () => {
  afterEach(() => {
    delete process.env["EXPO_PUBLIC_NATIVE_READER"];
    jest.resetModules();
  });

  it("is off by default on web (spec D1 — flag stays off until the flip)", () => {
    expect(loadFlag(undefined, "web")).toBe(false);
  });

  it("is on when EXPO_PUBLIC_NATIVE_READER=1 on web", () => {
    expect(loadFlag("1", "web")).toBe(true);
  });

  it("is off on native even when the env var is set (spec D3 — web-only)", () => {
    expect(loadFlag("1", "ios")).toBe(false);
    expect(loadFlag("1", "android")).toBe(false);
  });

  it("treats any value other than \"1\" as off", () => {
    expect(loadFlag("true", "web")).toBe(false);
    expect(loadFlag("0", "web")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/readerFlag.test.ts`
Expected: FAIL — `Cannot find module '@/constants/readerFlag'`.

- [ ] **Step 3: Write the flag**

Create `mobile/src/constants/readerFlag.ts`:

```ts
// Native web reader flag (spec 2026-07-09-native-web-reader-design.md, D1/D3).
//
// The web reader is being migrated off the sandboxed iframe onto real-DOM
// rendering. Until it reaches verified parity with the iframe — including the
// interactive quiz reveal that D6 defers to a fast-follow — the iframe stays the
// web default and this flag is OFF. Flipping the default here is the D1 "flip".
//
// Web-only by construction: the native (Android) renderer is react-native-webview
// and must never load DOMPurify/marked/mermaid, so no env var can turn this on
// off-web. Mirrors the IS_DEMO pattern in @/constants/demo.
import { Platform } from "react-native";

export const USE_NATIVE_WEB_READER =
  Platform.OS === "web" && process.env["EXPO_PUBLIC_NATIVE_READER"] === "1";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/readerFlag.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the CSS stub and wire it into Jest**

Create `mobile/__mocks__/styleMock.js`:

```js
// `import "katex/dist/katex.min.css"` is resolved by the metro web bundler but
// not by Jest. Map *.css to this empty module so reader tests can import the
// component under test.
module.exports = {};
```

In `mobile/jest.config.js`, extend `moduleNameMapper` (keep the existing `@/` mapping — CSS must come first so it wins for `.css` paths):

```js
  moduleNameMapper: {
    "\\.css$": "<rootDir>/__mocks__/styleMock.js",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
```

- [ ] **Step 6: Install mermaid**

Run: `cd mobile && npm install --save mermaid@^10.6.1`
Expected: `package.json` gains `"mermaid": "^10.6.1"`, `package-lock.json` updated.

Sanity-check it resolves and matches the version the iframe loads from CDN (`contentHtml.ts:290` pins `mermaid@10.6.1`):
Run: `cd mobile && node -e "console.log(require('mermaid/package.json').version)"`
Expected: a `10.x` version.

- [ ] **Step 7: Verify the full suite is still green**

Run: `cd mobile && npx jest`
Expected: PASS — no existing test regresses from the moduleNameMapper change.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/constants/readerFlag.ts mobile/__mocks__/styleMock.js \
        mobile/__tests__/reader/readerFlag.test.ts mobile/jest.config.js \
        mobile/package.json mobile/package-lock.json
git commit -m "feat(reader): add native-web-reader flag + mermaid dep + jest css stub"
```

---

### Task 2: `sanitize.ts` — the security boundary

This replaces the iframe. It gets its own file and its own adversarial test suite.

**Files:**
- Create: `mobile/src/reader/sanitize.ts`
- Test: `mobile/__tests__/reader/sanitize.test.ts`

**Interfaces:**
- Consumes: `dompurify`.
- Produces:
  - `sanitizeFragment(html: string): string` — the only sanitizer the reader uses.
  - `SANITIZE_CONFIG` — exported for the regression test only.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/sanitize.test.ts`. Note the docblock — without it `DOMPurify.sanitize` is `undefined`.

```ts
/**
 * @jest-environment jsdom
 */
import { sanitizeFragment } from "@/reader/sanitize";

// Matches an opening tag exactly, so `<animate>` does not match `<animateMotion>`.
const hasTag = (html: string, tag: string) =>
  new RegExp(`<${tag}[\\s/>]`, "i").test(html);

describe("sanitizeFragment — strips executable content", () => {
  it.each([
    ["script tag", "<p>hi</p><script>alert(1)</script>"],
    ["svg script", "<svg><script>alert(1)</script></svg>"],
    ["img onerror", '<img src="x" onerror="alert(1)">'],
    ["svg onload", '<svg onload="alert(1)"><rect onclick="x()"/></svg>'],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["iframe", '<iframe src="https://evil.test"></iframe>'],
    ["object", '<object data="x"></object>'],
    ["embed", '<embed src="x">'],
    ["form", '<form action="https://evil.test"><input name="a"></form>'],
    ["foreignObject", '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'],
  ])("removes %s", (_label, payload) => {
    const out = sanitizeFragment(payload);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<iframe|<object|<embed|<form|<foreignobject/i);
  });
});

describe("sanitizeFragment — keeps content the reader needs", () => {
  it("keeps ordinary prose markup", () => {
    const out = sanitizeFragment("<h2>Title</h2><p><em>a</em> <code>b</code></p><table><tr><td>c</td></tr></table>");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<code>b</code>");
    expect(out).toContain("<td>c</td>");
  });

  it("keeps math delimiters as literal text for the KaTeX post-pass", () => {
    expect(sanitizeFragment("<p>$$x^2 + y^2$$</p>")).toContain("$$x^2 + y^2$$");
  });

  // Spec D7. DOMPurify's svg profile strips these three by default; the bundled
  // book `claude-certified-architect-foundations` has 26 animated-SVG figures
  // that depend on them.
  it.each(["animate", "animateTransform", "set"])(
    "keeps <%s> (allowlisted per spec D7)",
    (tag) => {
      const out = sanitizeFragment(
        `<svg><circle><${tag} attributeName="cx" values="0;10" dur="2s"/></circle></svg>`,
      );
      expect(hasTag(out, tag)).toBe(true);
    },
  );

  it("keeps <animateMotion> and <style> inside svg", () => {
    const out = sanitizeFragment(
      '<svg><style>@keyframes k{from{opacity:0}}</style><path><animateMotion dur="3s"/></path></svg>',
    );
    expect(hasTag(out, "animateMotion")).toBe(true);
    expect(out).toContain("@keyframes");
  });
});

// The D7 allowlist would normally reopen the classic SVG-animation XSS
// (`<animate attributeName="href" values="javascript:...">`). DOMPurify 3.4.11
// drops href-targeting animation attributes even for allowlisted tags. These
// tests pin that behaviour so a dependency downgrade cannot silently reopen it.
describe("sanitizeFragment — animation allowlist does not reopen the href vector", () => {
  it.each([
    ["animate/href", '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'],
    ["set/xlink:href", '<svg><a><set attributeName="xlink:href" to="javascript:alert(1)"/></a></svg>'],
    ["animateTransform/href", '<svg><a><animateTransform attributeName="href" to="javascript:alert(1)"/></a></svg>'],
  ])("neutralises %s", (_label, payload) => {
    const out = sanitizeFragment(payload);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/attributeName\s*=\s*"?(xlink:)?href/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/sanitize.test.ts`
Expected: FAIL — `Cannot find module '@/reader/sanitize'`.

- [ ] **Step 3: Write the sanitizer**

Create `mobile/src/reader/sanitize.ts`:

```ts
// THE security boundary for the native web reader (spec D4).
//
// The iframe reader isolated untrusted content behind a null origin. The native
// reader has no such boundary: content is injected into the app's own document,
// where localStorage holds the Supabase session and the BYOK LLM key. DOMPurify
// is therefore the *only* thing preventing an XSS in model- or (via ADR-027
// draft sharing) other-user-authored content from exfiltrating those secrets.
//
// Web-only: DOMPurify needs a DOM. Never import this from a non-`.web` module.

import DOMPurify from "dompurify";

// SMIL animation elements. DOMPurify's svg profile strips these three by default
// (it keeps <animateMotion>), which would break the 26 animated-SVG figures in the
// bundled `claude-certified-architect-foundations` book. Animated SVG is a shipped
// product capability, so spec D7 sanctions allowlisting exactly these tags — they
// carry no script capability of their own.
//
// The classic vector these enable is animating an <a>'s href to a `javascript:`
// URL. DOMPurify 3.4.11 drops `attributeName="href"|"xlink:href"` on animation
// elements even when the element is allowlisted, so the vector stays closed;
// `__tests__/reader/sanitize.test.ts` pins that so a downgrade can't reopen it.
const ANIMATION_TAGS = ["animate", "animateTransform", "set"];

// The SMIL timing/target attributes those tags need. None is a URI attribute.
const ANIMATION_ATTRS = [
  "attributeName", "attributeType", "values", "from", "to", "by",
  "dur", "begin", "end", "repeatCount", "repeatDur", "restart",
  "keyTimes", "keySplines", "calcMode", "additive", "accumulate", "fill",
];

export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  ADD_TAGS: ANIMATION_TAGS,
  ADD_ATTR: ANIMATION_ATTRS,
  // Belt and braces: the profiles above already exclude these. Listed explicitly
  // so the intent survives a profile change. NEVER remove an entry to fix a render.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "foreignObject"],
  FORBID_ATTR: ["srcdoc", "formaction", "xlink:href"],
};

/** Untrusted HTML → HTML safe to inject into the app document. */
export function sanitizeFragment(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/sanitize.test.ts`
Expected: PASS — all describe blocks green.

If the `<animate>` allowlist tests fail, the fragment fixture is probably missing its `<svg>` wrapper: DOMPurify parses as HTML and drops SVG children that have no `<svg>` root. Do **not** loosen the config to fix it.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/reader/sanitize.ts mobile/__tests__/reader/sanitize.test.ts
git commit -m "feat(reader): DOMPurify sanitizer — the native reader's security boundary"
```

---

### Task 3: `markdown.ts` — marked renderer, fences, escaping

**Files:**
- Create: `mobile/src/reader/markdown.ts`
- Test: `mobile/__tests__/reader/markdown.test.ts`

**Interfaces:**
- Consumes: `marked`; nothing from Task 2 (sanitization happens once, at the end, in Task 4).
- Produces:
  - `md(text: string | undefined): string` — markdown → HTML, with mermaid/svg fence handling.
  - `escapeHtml(value: unknown): string`
  - `li(items: string[] | undefined): string` — `<li>`-wrapped, escaped.
  - `stripDupHeading(body: string | undefined, heading: string): string`

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/markdown.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { md, escapeHtml, li, stripDupHeading } from "@/reader/markdown";

describe("escapeHtml", () => {
  it("escapes the characters that could break out of markup", () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
  it("renders null and undefined as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("li", () => {
  it("escapes each item", () => {
    expect(li(["<script>", "b"])).toBe("<li>&lt;script&gt;</li><li>b</li>");
  });
  it("handles a missing list", () => {
    expect(li(undefined)).toBe("");
  });
});

describe("stripDupHeading", () => {
  it("drops a leading heading that repeats the section heading", () => {
    expect(stripDupHeading("## Why It Matters\n\nBody.", "Why it matters")).toBe("\nBody.");
  });
  it("keeps a leading heading that differs", () => {
    expect(stripDupHeading("## Something Else\n\nBody.", "Why it matters")).toContain("Something Else");
  });
  it("handles a missing body", () => {
    expect(stripDupHeading(undefined, "h")).toBe("");
  });
});

describe("md — prose", () => {
  it("renders markdown to html", () => {
    expect(md("**bold**")).toContain("<strong>bold</strong>");
  });
  it("renders GFM tables", () => {
    expect(md("| a |\n| - |\n| 1 |")).toContain("<table>");
  });
  it("leaves math delimiters untouched for the KaTeX post-pass", () => {
    expect(md("$$E = mc^2$$")).toContain("$$E = mc^2$$");
  });
  it("renders an empty/undefined body as empty string", () => {
    expect(md(undefined)).toBe("");
  });
});

describe("md — mermaid fences", () => {
  it("emits a .mermaid div for the lazy Mermaid pass", () => {
    expect(md("```mermaid\ngraph TD;\nA-->B\n```")).toContain('<div class="mermaid">');
  });

  // Spec D4: the mermaid SOURCE is untrusted. It must sit in the DOM as inert,
  // escaped text until Mermaid parses it. Mermaid reads textContent, which
  // un-escapes, so escaping does not break diagram rendering.
  it("escapes the mermaid source so it is inert until Mermaid renders it", () => {
    const out = md('```mermaid\ngraph TD;\nA-->B\n<img src=x onerror=alert(1)>\n```');
    expect(out).toContain("&lt;img");
    expect(out).not.toMatch(/<img/i);
  });
});

describe("md — svg fences", () => {
  it("emits the svg inline inside a figure so it can animate", () => {
    const out = md('```svg\n<svg viewBox="0 0 10 10"><circle r="2"/></svg>\n```');
    expect(out).toContain('<figure class="anim-svg">');
    expect(out).toContain("<svg");
  });

  // md() does NOT sanitize — renderContent's single final pass does (Task 4).
  // This asserts the fence is passed through raw, so the sanitizer sees it.
  it("passes svg through raw for the single final sanitize pass", () => {
    expect(md('```svg\n<svg onload="alert(1)"></svg>\n```')).toContain("onload");
  });
});

describe("md — ordinary code fences", () => {
  it("escapes code so it renders as text, not markup", () => {
    const out = md("```js\nvar x = '<b>';\n```");
    expect(out).toContain("&lt;b&gt;");
    expect(out).not.toContain("<b>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/markdown.test.ts`
Expected: FAIL — `Cannot find module '@/reader/markdown'`.

- [ ] **Step 3: Write the markdown layer**

Create `mobile/src/reader/markdown.ts`:

```ts
// Markdown → HTML for the native web reader. Mirrors the in-iframe helpers in
// `@/components/contentHtml` (RENDER_HELPERS_JS) so the two readers agree on
// markup while the flag is in flight.
//
// NOTHING here sanitizes. `renderContent.ts` makes exactly one sanitize pass
// over the assembled fragment, so every branch below must assume its output is
// still untrusted.
//
// Web-only: pulled in by the `.web` reader only.

import { marked } from "marked";

/** HTML-escape a value for interpolation into markup as text. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const renderer = new marked.Renderer();

renderer.code = function code(source: string, lang: string | undefined): string {
  if (lang === "mermaid") {
    // Escaped: the source is untrusted (spec D4). Mermaid reads `textContent`,
    // which un-escapes, so the diagram still renders.
    return `<div class="mermaid">${escapeHtml(source)}</div>`;
  }
  if (lang === "svg") {
    // Animated educational visuals (the free animated-visual path). Inlined raw so
    // SMIL/CSS animation works; the final DOMPurify pass strips scripts, handlers,
    // and href-targeting animations. Do not pre-strip here — one boundary only.
    return `<figure class="anim-svg">${source}</figure>`;
  }
  return `<pre><code>${escapeHtml(source)}</code></pre>`;
};

/** Markdown → HTML. Math delimiters survive as text for the KaTeX post-pass. */
export function md(text: string | undefined): string {
  return marked.parse(text ?? "", { async: false, renderer }) as string;
}

/** `<li>`-wrap a list of plain-text items. */
export function li(items: string[] | undefined): string {
  return (items ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
}

const normHeading = (s: unknown) =>
  String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The model often repeats a section's heading as a leading `## Heading` line in
 * `body_markdown`. We already emit the heading, so drop the duplicate.
 */
export function stripDupHeading(body: string | undefined, heading: string): string {
  const text = String(body ?? "");
  const m = text.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (m && m[1] !== undefined && normHeading(m[1]) === normHeading(heading)) {
    return text.slice(m[0].length);
  }
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/markdown.test.ts`
Expected: PASS.

If `md("**bold**")` returns a `Promise`, `{ async: false }` was dropped — marked v9 returns a promise without it.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/reader/markdown.ts mobile/__tests__/reader/markdown.test.ts
git commit -m "feat(reader): markdown layer with mermaid + animated-svg fences"
```

---

### Task 4: `renderContent.ts` — lesson, tutorial, experiment

Quiz is Task 5 so each gets its own reviewer gate.

**Files:**
- Create: `mobile/src/reader/renderContent.ts`
- Test: `mobile/__tests__/reader/renderContent.test.ts`

**Interfaces:**
- Consumes: `sanitizeFragment` (Task 2); `md`, `li`, `escapeHtml`, `stripDupHeading` (Task 3); `GeneratedTopic`, `TutorialOutput`, `ExperimentOutput` from `@/types/book`; `LessonOutput` from `@/types/lesson`.
- Produces: `renderTopicToSafeHtml(topic: GeneratedTopic): string` — one sanitized fragment. Task 5 adds the quiz branch to the same function; Task 8 consumes it.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/renderContent.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import type { GeneratedTopic } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

const lesson = (over: Partial<LessonOutput> = {}): LessonOutput => ({
  topic: "Scoped Retrieval",
  level: "adult",
  language: "en",
  synopsis: "A synopsis.",
  learning_objectives: ["Objective one"],
  sections: [{ heading: "Why It Matters", body_markdown: "Body **text**." }],
  key_takeaways: ["Takeaway one"],
  further_reading: ["A book"],
  ...over,
});

const topic = (over: Partial<GeneratedTopic> = {}): GeneratedTopic => ({
  topicId: "t1",
  title: "Scoped Retrieval",
  lesson: lesson(),
  generatedAt: "2026-07-10T00:00:00Z",
  ...over,
});

/** Every content type must satisfy this. The load-bearing assertion of the suite. */
function expectNoExecutableArtifacts(html: string) {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
}

describe("lesson", () => {
  it("renders title, synopsis, objectives, sections, takeaways", () => {
    const html = renderTopicToSafeHtml(topic());
    expect(html).toContain("<h1>Scoped Retrieval</h1>");
    expect(html).toContain("A synopsis.");
    expect(html).toContain("Objective one");
    expect(html).toContain("<h2>Why It Matters</h2>");
    expect(html).toContain("<strong>text</strong>");
    expect(html).toContain("Takeaway one");
    expect(html).toContain("A book");
  });

  it("drops a body heading that duplicates the section heading", () => {
    const html = renderTopicToSafeHtml(
      topic({ lesson: lesson({ sections: [{ heading: "Why It Matters", body_markdown: "## Why It Matters\n\nBody." }] }) }),
    );
    expect(html.match(/Why It Matters/g)).toHaveLength(1);
  });

  it("SECURITY: neutralises a payload in every lesson field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          topic: XSS,
          synopsis: XSS,
          learning_objectives: [XSS],
          sections: [{ heading: XSS, body_markdown: XSS }],
          key_takeaways: [XSS],
          further_reading: [XSS],
        }),
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("tutorial", () => {
  it("renders sections, examples, practice, common mistakes", () => {
    const html = renderTopicToSafeHtml(
      topic({
        tutorial: {
          title: "Hands On",
          sections: [{ section_id: "s1", title: "Step One", content: "Do *this*.", examples: ["`code`"], practice_question: "Try it?" }],
          common_mistakes: ["Skipping steps"],
        },
      }),
    );
    expect(html).toContain("Hands On");
    expect(html).toContain("Step One");
    expect(html).toContain("<em>this</em>");
    expect(html).toContain("Try it?");
    expect(html).toContain("Skipping steps");
  });

  it("SECURITY: neutralises a payload in every tutorial field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        tutorial: {
          title: XSS,
          sections: [{ section_id: "s1", title: XSS, content: XSS, examples: [XSS], practice_question: XSS }],
          common_mistakes: [XSS],
        },
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("experiment", () => {
  it("renders materials, safety, steps, questions, conclusion", () => {
    const html = renderTopicToSafeHtml(
      topic({
        experiment: {
          experiment_title: "Measure It",
          materials: ["A ruler"],
          safety_notes: ["Wear goggles"],
          steps: [{ step_number: 1, instruction: "Measure", expected_observation: "10cm" }],
          questions: [{ question: "Why?", answer: "Because." }],
          conclusion_prompt: "Summarise.",
        },
      }),
    );
    expect(html).toContain("Measure It");
    expect(html).toContain("A ruler");
    expect(html).toContain("Wear goggles");
    expect(html).toContain("10cm");
    expect(html).toContain("Because.");
    expect(html).toContain("Summarise.");
  });

  it("SECURITY: neutralises a payload in every experiment field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        experiment: {
          experiment_title: XSS,
          materials: [XSS],
          safety_notes: [XSS],
          steps: [{ step_number: 1, instruction: XSS, expected_observation: XSS }],
          questions: [{ question: XSS, answer: XSS }],
          conclusion_prompt: XSS,
        },
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});

describe("optional sections", () => {
  it("omits tutorial/quiz/experiment when absent", () => {
    const html = renderTopicToSafeHtml(topic());
    expect(html).not.toContain("Tutorial");
    expect(html).not.toContain("Experiment");
  });
});

describe("embedded fences", () => {
  it("keeps a mermaid div and an animated svg figure", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          sections: [{
            heading: "Diagrams",
            body_markdown:
              '```mermaid\ngraph TD;\nA-->B\n```\n\n```svg\n<svg><circle r="2"><animate attributeName="cx" values="0;10" dur="2s"/></circle></svg>\n```',
          }],
        }),
      }),
    );
    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('<figure class="anim-svg">');
    // Spec D7: the animation survives sanitization.
    expect(html).toMatch(/<animate[\s/>]/);
  });

  it("SECURITY: strips script/handlers from a hostile svg fence", () => {
    const html = renderTopicToSafeHtml(
      topic({
        lesson: lesson({
          sections: [{ heading: "D", body_markdown: '```svg\n<svg onload="alert(1)"><script>alert(2)</script></svg>\n```' }],
        }),
      }),
    );
    expectNoExecutableArtifacts(html);
    expect(html).toContain("<svg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts`
Expected: FAIL — `Cannot find module '@/reader/renderContent'`.

- [ ] **Step 3: Write the renderer**

Create `mobile/src/reader/renderContent.ts`:

```ts
// GeneratedTopic → one DOMPurify-sanitized HTML fragment for the native web
// reader. Pure: no React, no I/O, no DOM mutation — unit-testable in plain jest
// (with the jsdom environment DOMPurify requires).
//
// Markup mirrors `@/components/contentHtml` so the iframe and native readers
// agree while the flag is in flight (spec D5). The two must be kept in step until
// the iframe is retired on web.
//
// Web-only. Exactly ONE sanitize pass, at the bottom of renderTopicToSafeHtml.

import type { GeneratedTopic, ExperimentOutput, TutorialOutput } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { sanitizeFragment } from "@/reader/sanitize";
import { escapeHtml, li, md, stripDupHeading } from "@/reader/markdown";

const DIVIDER = '<hr class="section-divider">';

function renderLesson(lesson: LessonOutput): string {
  let h = `<h1>${escapeHtml(lesson.topic)}</h1>`;
  h += `<p class="synopsis">${escapeHtml(lesson.synopsis)}</p>`;
  h += `<div class="objectives"><h3>Learning objectives</h3><ul>${li(lesson.learning_objectives)}</ul></div>`;
  for (const s of lesson.sections ?? []) {
    h += DIVIDER;
    h += `<h2>${escapeHtml(s.heading)}</h2>`;
    h += md(stripDupHeading(s.body_markdown, s.heading));
  }
  h += DIVIDER;
  h += `<div class="takeaways"><h3>Key takeaways</h3><ul>${li(lesson.key_takeaways)}</ul></div>`;
  if (lesson.further_reading?.length) {
    h += `<div class="further"><h3>Further reading</h3><ul>${li(lesson.further_reading)}</ul></div>`;
  }
  return h;
}

function renderTutorial(tut: TutorialOutput): string {
  let h = `${DIVIDER}<h2>${escapeHtml(tut.title || "Tutorial")}</h2>`;
  for (const s of tut.sections ?? []) {
    h += `<h3>${escapeHtml(s.title)}</h3>`;
    h += md(s.content);
    if (s.examples?.length) {
      h += '<div class="examples"><h4>Examples</h4>';
      for (const ex of s.examples) h += md(ex);
      h += "</div>";
    }
    if (s.practice_question) {
      h += `<div class="practice"><b>Practice:</b> ${escapeHtml(s.practice_question)}</div>`;
    }
  }
  if (tut.common_mistakes?.length) {
    h += `<div class="mistakes"><h3>Common mistakes</h3><ul>${li(tut.common_mistakes)}</ul></div>`;
  }
  return h;
}

function renderExperiment(exp: ExperimentOutput): string {
  let h = `${DIVIDER}<h2>${escapeHtml(exp.experiment_title || "Experiment")}</h2>`;
  if (exp.materials?.length) {
    h += `<div class="materials"><h3>Materials</h3><ul>${li(exp.materials)}</ul></div>`;
  }
  if (exp.safety_notes?.length) {
    h += `<div class="safety"><h3>Safety</h3><ul>${li(exp.safety_notes)}</ul></div>`;
  }
  if (exp.steps?.length) {
    h += "<h3>Steps</h3><ol>";
    for (const st of exp.steps) {
      h += `<li class="step">${escapeHtml(st.instruction)}`;
      h += `<div class="obs">Expected: ${escapeHtml(st.expected_observation)}</div></li>`;
    }
    h += "</ol>";
  }
  if (exp.questions?.length) {
    h += '<div class="exp-questions"><h3>Questions</h3>';
    for (const qa of exp.questions) {
      h += `<p><b>Q:</b> ${escapeHtml(qa.question)}<br><b>A:</b> ${escapeHtml(qa.answer)}</p>`;
    }
    h += "</div>";
  }
  if (exp.conclusion_prompt) {
    h += `<div class="practice"><b>Conclusion:</b> ${escapeHtml(exp.conclusion_prompt)}</div>`;
  }
  return h;
}

/** Untrusted topic → sanitized HTML fragment, safe to inject into the app DOM. */
export function renderTopicToSafeHtml(topic: GeneratedTopic): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  return sanitizeFragment(html);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts`
Expected: PASS. (The `optional sections` test passes trivially now; it guards Task 5.)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/reader/renderContent.ts mobile/__tests__/reader/renderContent.test.ts
git commit -m "feat(reader): render lesson/tutorial/experiment to sanitized html"
```

---

### Task 5: Quiz rendering (static reveal — spec D6)

**Files:**
- Modify: `mobile/src/reader/renderContent.ts` (add `renderQuizzes`, call it from `renderTopicToSafeHtml`)
- Test: `mobile/__tests__/reader/renderContent.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `QuizSet` from `@/types/book`.
- Produces: no new exports. `renderTopicToSafeHtml` now emits the quiz block between tutorial and experiment (matching `contentHtml.ts:326-329` ordering).

- [ ] **Step 1: Write the failing test**

Append to `mobile/__tests__/reader/renderContent.test.ts` — but move the `import type { QuizSet }` line up to join the other imports at the **top** of the file; ES imports cannot sit mid-file.

```ts
import type { QuizSet } from "@/types/book"; // ← goes with the imports at the top

const quizSet = (over: Partial<QuizSet> = {}): QuizSet => ({
  set_number: 1,
  questions: [{
    question_id: "q1",
    question_text: "What is $x$?",
    question_type: "multiple_choice",
    options: [
      { option_id: "A", text: "Wrong" },
      { option_id: "B", text: "Right" },
    ],
    correct_option: "B",
    explanation: "Because **B**.",
    difficulty: "easy",
  }],
  total_questions: 1,
  passing_score: null,
  estimated_duration_minutes: null,
  ...over,
});

describe("quiz", () => {
  it("renders questions, options, and marks the correct one", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }));
    expect(html).toContain("<h2>Quiz</h2>");
    expect(html).toContain("What is $x$?");
    expect(html).toContain("Wrong");
    expect(html).toContain('class="correct"');
  });

  // Spec D6: v1 reveal is STATIC — answer and explanation are always in the DOM.
  // No in-page script, no React reveal state.
  it("shows the answer and explanation statically", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }));
    expect(html).toContain('<div class="quiz-answer">');
    expect(html).toContain("B");
    expect(html).toContain("<strong>B</strong>");
    expect(html).toContain("easy");
  });

  it("labels each set when there is more than one", () => {
    const html = renderTopicToSafeHtml(topic({ quizSets: [quizSet(), quizSet({ set_number: 2 })] }));
    expect(html).toContain("Set 1");
    expect(html).toContain("Set 2");
  });

  it("omits the set label for a single set", () => {
    expect(renderTopicToSafeHtml(topic({ quizSets: [quizSet()] }))).not.toContain("Set 1");
  });

  it("omits the quiz block for an empty quizSets array", () => {
    expect(renderTopicToSafeHtml(topic({ quizSets: [] }))).not.toContain("<h2>Quiz</h2>");
  });

  it("SECURITY: neutralises a payload in every quiz field", () => {
    const html = renderTopicToSafeHtml(
      topic({
        quizSets: [quizSet({
          questions: [{
            question_id: "q1",
            question_text: XSS,
            question_type: "multiple_choice",
            options: [{ option_id: XSS, text: XSS }],
            correct_option: XSS,
            explanation: XSS,
            difficulty: XSS,
          }],
        })],
      }),
    );
    expectNoExecutableArtifacts(html);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts -t quiz`
Expected: FAIL — no `<h2>Quiz</h2>` in the output.

- [ ] **Step 3: Add the quiz renderer**

In `mobile/src/reader/renderContent.ts`, extend the type import and add `renderQuizzes` after `renderTutorial`:

```ts
import type { GeneratedTopic, ExperimentOutput, QuizSet, TutorialOutput } from "@/types/book";
```

```ts
// Static reveal (spec D6): the answer and explanation are always present. The
// iframe revealed them with in-page JS; the native reader has no in-page script,
// and interactive reveal is the fast-follow that gates the D1 flag flip.
function renderQuizzes(sets: QuizSet[]): string {
  let h = `${DIVIDER}<h2>Quiz</h2>`;
  for (const set of sets) {
    if (sets.length > 1 && set.set_number != null) {
      h += `<h3>Set ${escapeHtml(set.set_number)}</h3>`;
    }
    (set.questions ?? []).forEach((q, i) => {
      h += '<div class="quiz-q">';
      h += `<div class="quiz-qtext">${md(`${i + 1}. ${q.question_text || ""}`)}</div>`;
      h += '<ul class="quiz-options">';
      for (const o of q.options ?? []) {
        const correct = o.option_id === q.correct_option;
        h += `<li class="${correct ? "correct" : ""}"><b>${escapeHtml(o.option_id)}.</b> `;
        h += `${escapeHtml(o.text)}${correct ? " ✓" : ""}</li>`;
      }
      h += "</ul>";
      h += `<div class="quiz-answer"><b>Answer:</b> ${escapeHtml(q.correct_option)}</div>`;
      if (q.explanation) h += `<div class="quiz-expl">${md(q.explanation)}</div>`;
      if (q.difficulty) h += `<div class="difficulty">${escapeHtml(q.difficulty)}</div>`;
      h += "</div>";
    });
  }
  return h;
}
```

Then wire it into `renderTopicToSafeHtml`, preserving `contentHtml.ts`'s order:

```ts
export function renderTopicToSafeHtml(topic: GeneratedTopic): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.quizSets?.length) html += renderQuizzes(topic.quizSets);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  return sanitizeFragment(html);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/renderContent.test.ts`
Expected: PASS — all describes, including the earlier `optional sections` one.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/reader/renderContent.ts mobile/__tests__/reader/renderContent.test.ts
git commit -m "feat(reader): render quiz sets with static reveal (spec D6)"
```

---

### Task 6: `readerStyles.ts` — the ported stylesheet

**Files:**
- Create: `mobile/src/reader/readerStyles.ts`

**Interfaces:**
- Consumes: `colors` from `@/constants/theme`.
- Produces: `READER_CSS: string` — every rule scoped under `.mentible-reader`. Task 7 injects it in a `<style>` tag.

There is no unit test here: CSS text has no behaviour worth asserting, and the parity check is visual (Task 10). The one structural invariant — that every rule is scoped — is asserted in Task 8's component test.

- [ ] **Step 1: Write the stylesheet**

Create `mobile/src/reader/readerStyles.ts`. Port `contentHtml.ts:161-282` verbatim, with three changes: (1) every selector is prefixed with `.mentible-reader` so reader CSS cannot leak into the app shell (the iframe gave this for free); (2) `body` becomes `.mentible-reader` itself; (3) no `@font-face` or Google Fonts link — the app's own bundled fonts already apply.

```ts
// The native web reader's stylesheet — ported from `@/components/contentHtml`'s
// in-iframe <style> block (spec D5: "ports contentHtml.ts's stylesheet so the look
// matches or beats it").
//
// SCOPING MATTERS. The iframe isolated these rules; injected into the app document
// they would restyle the whole shell. Every selector is therefore nested under
// `.mentible-reader`, the class on the reader's container.
//
// Fonts are NOT loaded here. The iframe fetched Source Serif 4 from Google Fonts;
// the app already bundles its fonts via expo-font, so the reader inherits them.

import { colors } from "@/constants/theme";

export const READER_ROOT_CLASS = "mentible-reader";

export const READER_CSS = `
.${READER_ROOT_CLASS} {
  --bg: ${colors.background};
  --surface: ${colors.surface};
  --border: ${colors.border};
  --text: ${colors.text};
  --text2: ${colors.textSecondary};
  --muted: ${colors.textMuted};
  --primary: ${colors.primary};
  --success: ${colors.success};
  --warning: ${colors.warning};
  --sans: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
  --serif: 'Source Serif 4', "Noto Serif", Georgia, "Times New Roman", "Liberation Serif", serif;

  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  font-weight: 400;
  font-size: 16px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  padding: 20px 18px 40px;
  max-width: 42rem;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}
.${READER_ROOT_CLASS} * { box-sizing: border-box; margin: 0; padding: 0; }
.${READER_ROOT_CLASS} h1, .${READER_ROOT_CLASS} h2, .${READER_ROOT_CLASS} h3,
.${READER_ROOT_CLASS} h4, .${READER_ROOT_CLASS} h5, .${READER_ROOT_CLASS} h6 {
  font-family: var(--sans); line-height: 1.3;
}
.${READER_ROOT_CLASS} h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h2 { font-size: 1.3rem; font-weight: 700; margin: 24px 0 8px; color: var(--text); }
.${READER_ROOT_CLASS} h3 { font-size: 1.1rem; font-weight: 600; margin: 18px 0 6px; color: var(--text2); }
.${READER_ROOT_CLASS} h4, .${READER_ROOT_CLASS} h5, .${READER_ROOT_CLASS} h6 { font-size: 1rem; font-weight: 600; margin: 14px 0 4px; }
.${READER_ROOT_CLASS} p { margin: 12px 0; }
.${READER_ROOT_CLASS} ul, .${READER_ROOT_CLASS} ol { padding-left: 22px; margin: 8px 0; }
.${READER_ROOT_CLASS} li { margin: 4px 0; }
.${READER_ROOT_CLASS} code {
  font-family: "Menlo", "Courier New", monospace; font-size: 0.88em;
  background: var(--surface); padding: 2px 5px; border-radius: 4px; color: #e2e8f0;
}
.${READER_ROOT_CLASS} pre {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; overflow-x: auto; margin: 12px 0;
}
.${READER_ROOT_CLASS} pre code { background: none; padding: 0; }
.${READER_ROOT_CLASS} blockquote {
  border-left: 3px solid var(--primary); padding: 8px 12px; margin: 12px 0;
  color: var(--text2); font-style: italic;
}
.${READER_ROOT_CLASS} table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; display: block; overflow-x: auto; }
.${READER_ROOT_CLASS} th { background: var(--surface); color: var(--text); font-weight: 600; padding: 8px 12px; border: 1px solid var(--border); text-align: left; }
.${READER_ROOT_CLASS} td { padding: 7px 12px; border: 1px solid var(--border); color: var(--text2); }
.${READER_ROOT_CLASS} tr:nth-child(even) td { background: var(--surface); }
.${READER_ROOT_CLASS} a { color: var(--primary); }
.${READER_ROOT_CLASS} img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 8px; }
.${READER_ROOT_CLASS} hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.${READER_ROOT_CLASS} .synopsis {
  color: var(--text2); font-size: 0.95em; margin: 12px 0 20px; padding: 12px;
  background: var(--surface); border-radius: 8px; border-left: 3px solid var(--primary);
}
.${READER_ROOT_CLASS} .objectives, .${READER_ROOT_CLASS} .takeaways, .${READER_ROOT_CLASS} .further,
.${READER_ROOT_CLASS} .mistakes, .${READER_ROOT_CLASS} .examples {
  background: var(--surface); border-radius: 8px; padding: 12px 16px; margin: 16px 0;
}
.${READER_ROOT_CLASS} .objectives { border-left: 3px solid var(--primary); }
.${READER_ROOT_CLASS} .takeaways { border-left: 3px solid var(--success); }
.${READER_ROOT_CLASS} .further { border-left: 3px solid var(--muted); }
.${READER_ROOT_CLASS} .mistakes { border-left: 3px solid var(--warning); }
.${READER_ROOT_CLASS} .objectives h3 { color: var(--primary); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .takeaways h3 { color: var(--success); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .further h3 { color: var(--muted); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .mistakes h3 { color: var(--warning); margin-bottom: 8px; }
.${READER_ROOT_CLASS} .practice {
  background: var(--surface); border-left: 3px solid var(--warning);
  padding: 8px 12px; border-radius: 6px; margin: 10px 0;
}
.${READER_ROOT_CLASS} .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.${READER_ROOT_CLASS} .quiz-q {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px; margin: 12px 0;
}
.${READER_ROOT_CLASS} .quiz-options { list-style: none; padding-left: 0; margin: 8px 0; }
.${READER_ROOT_CLASS} .quiz-options li { padding: 4px 0; color: var(--text2); }
.${READER_ROOT_CLASS} .quiz-options li.correct { color: var(--success); font-weight: 600; }
.${READER_ROOT_CLASS} .quiz-answer { margin-top: 8px; color: var(--success); font-size: 0.9em; }
.${READER_ROOT_CLASS} .quiz-expl { color: var(--text2); font-size: 0.9em; }
.${READER_ROOT_CLASS} .difficulty { margin-top: 6px; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.${READER_ROOT_CLASS} .materials, .${READER_ROOT_CLASS} .safety, .${READER_ROOT_CLASS} .exp-questions { margin: 12px 0; }
.${READER_ROOT_CLASS} .safety { border-left: 3px solid var(--warning); padding-left: 12px; }
.${READER_ROOT_CLASS} .step { margin: 8px 0; }
.${READER_ROOT_CLASS} .step .obs { color: var(--text2); font-style: italic; font-size: 0.92em; }
.${READER_ROOT_CLASS} .mermaid { margin: 12px 0; }
.${READER_ROOT_CLASS} .mermaid svg { max-width: 100%; }
.${READER_ROOT_CLASS} .anim-svg {
  margin: 16px 0; text-align: center; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 12px;
}
.${READER_ROOT_CLASS} .anim-svg svg { max-width: 100%; height: auto; }
.${READER_ROOT_CLASS} .katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
`;
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -F "src/reader/readerStyles.ts" || echo "clean"`
Expected: `clean`.

(Per the 2026-07-03 session note: run `tsc`, not just jest, on TypeScript edits. A bare `tsc` run in this repo emits ~529 pre-existing environment errors — grep for the file you touched.)

- [ ] **Step 3: Commit**

```bash
git add mobile/src/reader/readerStyles.ts
git commit -m "feat(reader): port the iframe stylesheet, scoped to .mentible-reader"
```

---

### Task 7: `enhance.ts` — the DOM post-passes (KaTeX + lazy Mermaid)

These run against a real `HTMLElement`. They live outside the component because, under
RNTL, `ref.current` is `null` and nothing reaches `document` — so a component test
could never exercise them. Here they are testable against a genuine jsdom node.

**Files:**
- Create: `mobile/src/reader/enhance.ts`
- Test: `mobile/__tests__/reader/enhance.test.ts`

**Interfaces:**
- Consumes: `katex/contrib/auto-render`; dynamic `import("mermaid")`.
- Produces:
  - `renderMath(node: HTMLElement): void`
  - `renderDiagrams(node: HTMLElement, isCancelled?: () => boolean): Promise<boolean>` — resolves `true` iff Mermaid was loaded and run.
  - `enhanceReaderNode(node: HTMLElement): () => void` — runs both, returns a cleanup function. Task 8 consumes this one.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/enhance.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { enhanceReaderNode, renderDiagrams, renderMath } from "@/reader/enhance";

const mermaidRun = jest.fn().mockResolvedValue(undefined);
const mermaidInitialize = jest.fn();
jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: (...a: unknown[]) => mermaidInitialize(...a),
    run: (...a: unknown[]) => mermaidRun(...a),
  },
}));

const renderMathInElement = jest.fn();
jest.mock("katex/contrib/auto-render", () => ({
  __esModule: true,
  default: (...a: unknown[]) => renderMathInElement(...a),
}));

function nodeWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

describe("renderMath", () => {
  it("runs KaTeX over the node with both delimiter forms", () => {
    const node = nodeWith("<p>$$x^2$$</p>");
    renderMath(node);
    expect(renderMathInElement).toHaveBeenCalledWith(
      node,
      expect.objectContaining({
        throwOnError: false,
        ignoredClasses: expect.arrayContaining(["mermaid", "anim-svg"]),
        delimiters: expect.arrayContaining([
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ]),
      }),
    );
  });
});

describe("renderDiagrams — lazy (spec D2)", () => {
  it("does NOT load mermaid when the node has no diagram", async () => {
    expect(await renderDiagrams(nodeWith("<p>Just prose.</p>"))).toBe(false);
    expect(mermaidInitialize).not.toHaveBeenCalled();
    expect(mermaidRun).not.toHaveBeenCalled();
  });

  it("loads and runs mermaid when the node has a diagram", async () => {
    const node = nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>');
    expect(await renderDiagrams(node)).toBe(true);
    expect(mermaidRun).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [node.querySelector(".mermaid")] }),
    );
  });

  it("configures mermaid with securityLevel strict and no autostart (spec D4)", async () => {
    await renderDiagrams(nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>'));
    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  it("skips the run when cancelled before mermaid resolves (unmount race)", async () => {
    const node = nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>');
    expect(await renderDiagrams(node, () => true)).toBe(false);
    expect(mermaidRun).not.toHaveBeenCalled();
  });
});

describe("enhanceReaderNode", () => {
  it("runs the math pass immediately and returns a cleanup function", () => {
    const cleanup = enhanceReaderNode(nodeWith("<p>$x$</p>"));
    expect(renderMathInElement).toHaveBeenCalled();
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("cleanup prevents a late mermaid run", async () => {
    const cleanup = enhanceReaderNode(nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>'));
    cleanup(); // unmount before the ~3MB chunk resolves
    // Flush the microtask queue AND the macrotask queue — two `await Promise.resolve()`
    // is not enough to settle the dynamic import's promise chain.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mermaidRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/enhance.test.ts`
Expected: FAIL — `Cannot find module '@/reader/enhance'`.

- [ ] **Step 3: Write the post-passes**

Create `mobile/src/reader/enhance.ts`:

```ts
// The native web reader's post-mount DOM passes. Deliberately NOT inside the
// component: React Native Testing Library renders through react-test-renderer, so a
// host `ref.current` is null and nothing lands in `document`. Keeping these as plain
// functions over an HTMLElement means they can be tested against a real jsdom node
// instead of asserted vacuously.
//
// Both passes run AFTER sanitization, on markup the sanitizer already cleared. The
// HTML they add (KaTeX spans, Mermaid <svg>) is library-produced, not model-produced.
//
// Web-only.

import renderMathInElement from "katex/contrib/auto-render";

/** Render `$…$` / `$$…$$` in place. Mermaid and raw-SVG figures are skipped. */
export function renderMath(node: HTMLElement): void {
  renderMathInElement(node, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    ignoredClasses: ["mermaid", "anim-svg"],
    throwOnError: false,
  });
}

/**
 * Render any `.mermaid` blocks. Mermaid is ~3MB, so it is dynamically imported ONLY
 * when the topic actually contains a diagram (spec D2) — prose-only topics never pay
 * for it. `securityLevel: "strict"` disables click handlers and HTML labels; the
 * diagram source sat in the DOM as escaped text until this moment (spec D4).
 *
 * Resolves true iff Mermaid was loaded and run.
 */
export async function renderDiagrams(
  node: HTMLElement,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  const nodes = Array.from(node.querySelectorAll<HTMLElement>(".mermaid"));
  if (nodes.length === 0) return false;

  const mermaid = (await import("mermaid")).default;
  // The component may have unmounted while the ~3MB chunk was in flight.
  if (isCancelled()) return false;

  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  await mermaid.run({ nodes });
  return true;
}

/** Run every post-pass on a mounted reader node. Returns an unmount cleanup. */
export function enhanceReaderNode(node: HTMLElement): () => void {
  let cancelled = false;
  renderMath(node);
  void renderDiagrams(node, () => cancelled);
  return () => {
    cancelled = true;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/enhance.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -F "src/reader/enhance" || echo "clean"`
Expected: `clean`. If `katex/contrib/auto-render` ships no types, create `mobile/src/types/katex-auto-render.d.ts`:

```ts
declare module "katex/contrib/auto-render" {
  interface AutoRenderOptions {
    delimiters?: { left: string; right: string; display: boolean }[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
  }
  export default function renderMathInElement(elem: HTMLElement, options?: AutoRenderOptions): void;
}
```

- [ ] **Step 6: Commit**

```bash
git add mobile/src/reader/enhance.ts mobile/__tests__/reader/enhance.test.ts
git add mobile/src/types/katex-auto-render.d.ts 2>/dev/null || true
git commit -m "feat(reader): katex + lazily-loaded mermaid dom passes"
```

---

### Task 8: `NativeTopicReader` — the component

**Files:**
- Create: `mobile/src/reader/NativeTopicReader.web.tsx`
- Create: `mobile/src/reader/NativeTopicReader.tsx`
- Test: `mobile/__tests__/reader/NativeTopicReader.test.tsx`

**Interfaces:**
- Consumes: `renderTopicToSafeHtml` (Tasks 4–5), `READER_CSS` + `READER_ROOT_CLASS` (Task 6), `enhanceReaderNode` (Task 7).
- Produces: `NativeTopicReader({ topic }: { topic: GeneratedTopic }): JSX.Element` from both files. Task 9 consumes it.

**Read before starting:** two facts from Global Constraints. (1) The test **must** import `@/reader/NativeTopicReader.web` by explicit path — jest's haste config has no `web` platform, so the bare path resolves to the native stub and the suite would test nothing. (2) RNTL has no DOM: assert **props** via `UNSAFE_root.findByType`, never `document`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/reader/NativeTopicReader.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react-native";
// EXPLICIT `.web` path: jest-expo's haste defaultPlatform is "ios" and its platform
// list has no "web", so `@/reader/NativeTopicReader` resolves to the throwing native
// stub. Metro picks the `.web.tsx` on the real web bundle.
import { NativeTopicReader } from "@/reader/NativeTopicReader.web";
import type { GeneratedTopic } from "@/types/book";

// enhanceReaderNode touches a real HTMLElement; under RNTL the ref is null, so the
// effect no-ops. Mocked to assert the wiring; its behaviour is covered by enhance.test.ts.
const enhanceReaderNode = jest.fn(() => jest.fn());
jest.mock("@/reader/enhance", () => ({
  enhanceReaderNode: (...a: unknown[]) => enhanceReaderNode(...(a as [])),
}));

const topic = (body: string): GeneratedTopic => ({
  topicId: "t1",
  title: "T",
  generatedAt: "2026-07-10T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [{ heading: "H", body_markdown: body }],
    key_takeaways: [], further_reading: [],
  },
});

const readerDiv = (root: ReturnType<typeof render>["UNSAFE_root"]) =>
  root.findAll((n) => n.type === ("div" as never) && n.props.className === "mentible-reader")[0];

beforeEach(() => jest.clearAllMocks());

it("renders the topic content inline — no iframe anywhere in the tree", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("Hello **world**.")} />);
  expect(UNSAFE_root.findAll((n) => n.type === ("iframe" as never))).toHaveLength(0);
  expect(readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html).toContain("<strong>world</strong>");
});

it("SECURITY: a hostile topic yields no executable markup in the injected html", () => {
  const { UNSAFE_root } = render(
    <NativeTopicReader topic={topic('<img src=x onerror="alert(1)"><script>alert(2)</script>')} />,
  );
  const html: string = readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html;
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
});

// Under react-test-renderer `ref.current` is null, so the effect's guard short-circuits
// and enhanceReaderNode is never reached. This test pins the guard: without it the effect
// would throw on `node.querySelector` when mounted outside a browser. The pass itself is
// covered against a real DOM node in enhance.test.ts.
it("does not crash when mounted without a real DOM node, and leaves math as text", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("$$x^2$$")} />);
  expect(enhanceReaderNode).not.toHaveBeenCalled();
  // The math survived sanitization as literal text, ready for the KaTeX pass on web.
  expect(readerDiv(UNSAFE_root)!.props.dangerouslySetInnerHTML.__html).toContain("$$x^2$$");
});

it("emits a scoped stylesheet — every rule sits under the reader root class", () => {
  const { UNSAFE_root } = render(<NativeTopicReader topic={topic("x")} />);
  const style = UNSAFE_root.findAll((n) => n.type === ("style" as never))[0];
  const css: string = style!.props.children;
  // Extract each rule's selector: the text before "{" in every "…{…}" block. Do NOT
  // filter lines ending in "{" — most rules in readerStyles.ts are single-line, so
  // that would inspect only ~10 of the ~49 rules and silently under-test the invariant.
  const selectors = css
    .split("}")
    .map((block) => block.split("{")[0]!.trim())
    .filter(Boolean);
  expect(selectors.length).toBeGreaterThan(40); // 49 rules ported from the iframe
  for (const sel of selectors) expect(sel).toContain(".mentible-reader");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/reader/NativeTopicReader.test.tsx`
Expected: FAIL — `Cannot find module '@/reader/NativeTopicReader.web'`.

- [ ] **Step 3: Write the native stub first**

Create `mobile/src/reader/NativeTopicReader.tsx`:

```tsx
// Native (Android/iOS) stub. Metro resolves `NativeTopicReader.web.tsx` on web and
// this file everywhere else, which is what keeps DOMPurify / marked / mermaid out
// of the native bundle entirely (spec D3).
//
// It should never render: `USE_NATIVE_WEB_READER` is false off-web, so
// `TopicRenderer` always picks the react-native-webview path. Throwing makes a
// wiring mistake loud instead of shipping a blank screen.
import type { GeneratedTopic } from "@/types/book";

export function NativeTopicReader(_props: { topic: GeneratedTopic }): never {
  throw new Error(
    "NativeTopicReader is web-only (spec D3). Native must render TopicRenderer's WebView path.",
  );
}
```

- [ ] **Step 4: Write the web component**

Create `mobile/src/reader/NativeTopicReader.web.tsx`:

```tsx
// The native web reader (spec D1–D7): a book topic rendered into the app's own
// DOM instead of a sandboxed iframe. This is what buys whole-page text selection,
// browser find-in-page, real semantic headings, and the app's bundled fonts.
//
// Security: there is no iframe boundary here, so `renderTopicToSafeHtml` (which
// ends in a DOMPurify pass) IS the boundary. Never inject anything into this
// subtree that has not been through it.

import React, { useEffect, useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import "katex/dist/katex.min.css";
import type { GeneratedTopic } from "@/types/book";
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { READER_CSS, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { enhanceReaderNode } from "@/reader/enhance";
import { colors } from "@/constants/theme";

export function NativeTopicReader({ topic }: { topic: GeneratedTopic }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderTopicToSafeHtml(topic), [topic]);

  // KaTeX and (lazily) Mermaid, over the mounted node. `ref.current` is null under
  // react-test-renderer, so this guard also makes the component test-safe.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    return enhanceReaderNode(node);
  }, [html]);

  return (
    <View style={styles.container}>
      <style data-mentible-reader="">{READER_CSS}</style>
      <div
        ref={ref}
        className={READER_ROOT_CLASS}
        // SAFE: `html` is the output of renderTopicToSafeHtml → sanitizeFragment.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/reader/NativeTopicReader.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck**

Run: `cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -F "src/reader/" || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/reader/NativeTopicReader.web.tsx mobile/src/reader/NativeTopicReader.tsx \
        mobile/__tests__/reader/NativeTopicReader.test.tsx
git commit -m "feat(reader): NativeTopicReader component — inject sanitized html, scoped css"
```

---

### Task 9: Wire the flag into `TopicRenderer`

**Files:**
- Modify: `mobile/src/components/LessonRenderer.tsx` (add the switch to `TopicRenderer`, lines 86-90)
- Test: `mobile/__tests__/components/TopicRenderer.switch.test.tsx`

**Interfaces:**
- Consumes: `USE_NATIVE_WEB_READER` (Task 1), `NativeTopicReader` (Task 8).
- Produces: no signature change. `TopicRenderer({ topic })` keeps its public shape, so `app/book/topic/[bookId]/[topicId].tsx:14` and `app/book/shared/[id].tsx:8` need no edit.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/TopicRenderer.switch.test.tsx`. The preamble
(`jest.mock("react-native-webview")` + forcing `Platform.OS`) mirrors the existing
`__tests__/components/LessonRenderer.test.tsx`, and for the same reasons: the module-level
`require("react-native-webview")` runs at import, and `jest-expo` defaults `Platform.OS`
to `"ios"`. Assertions read **props** — RNTL has no DOM.

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import type { GeneratedTopic } from "@/types/book";

jest.mock("react-native-webview", () => ({ default: () => null }));

beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});

const topic: GeneratedTopic = {
  topicId: "t1", title: "T", generatedAt: "2026-07-10T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [], key_takeaways: [], further_reading: [],
  },
};

function renderWithFlag(flagOn: boolean) {
  let result: ReturnType<typeof render> | null = null;
  jest.isolateModules(() => {
    jest.doMock("@/constants/readerFlag", () => ({ USE_NATIVE_WEB_READER: flagOn }));
    // In jest, `@/reader/NativeTopicReader` resolves to the throwing native stub —
    // haste has no "web" platform. Metro picks the `.web.tsx` on the real bundle.
    jest.doMock("@/reader/NativeTopicReader", () => ({
      NativeTopicReader: () => React.createElement("div", { className: "native-reader-stand-in" }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TopicRenderer } = require("@/components/LessonRenderer");
    result = render(<TopicRenderer topic={topic} />);
  });
  const root = result!.UNSAFE_root;
  return {
    iframes: root.findAll((n) => n.type === ("iframe" as never)),
    natives: root.findAll(
      (n) => n.type === ("div" as never) && n.props.className === "native-reader-stand-in",
    ),
  };
}

afterEach(() => jest.resetModules());

it("flag OFF → renders the iframe path (no user-visible change; spec D1)", () => {
  const { iframes, natives } = renderWithFlag(false);
  expect(iframes).toHaveLength(1);
  expect(natives).toHaveLength(0);
});

it("flag ON → renders the native reader, and no iframe is mounted", () => {
  const { iframes, natives } = renderWithFlag(true);
  expect(natives).toHaveLength(1);
  expect(iframes).toHaveLength(0);
});

it("the iframe path still carries its sandbox (regression guard)", () => {
  const { iframes } = renderWithFlag(false);
  expect(iframes[0]!.props.sandbox).toBe("allow-scripts");
  expect(String(iframes[0]!.props.sandbox)).not.toContain("allow-same-origin");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/TopicRenderer.switch.test.tsx`
Expected: FAIL — the "flag ON" case still renders an iframe.

- [ ] **Step 3: Add the switch**

In `mobile/src/components/LessonRenderer.tsx`, add two imports after line 6:

```tsx
import { USE_NATIVE_WEB_READER } from "@/constants/readerFlag";
import { NativeTopicReader } from "@/reader/NativeTopicReader";
```

Then replace `TopicRenderer` (lines 86-90) with:

```tsx
/**
 * Renders a full book topic — lesson plus any tutorial / quiz sets / experiment.
 *
 * Two implementations. The default is the sandboxed iframe (web) / WebView (native)
 * below. On web with EXPO_PUBLIC_NATIVE_READER=1 it delegates to NativeTopicReader,
 * which renders into the app's own DOM — real text selection, find-in-page, semantic
 * headings, bundled fonts. The switch lives here (not at the two call sites) so the
 * Studio topic screen and the shared-draft reader can never drift apart.
 *
 * Flipping the flag's default is the spec's D1 "flip"; it is gated on the interactive
 * quiz reveal landing, since v1 of the native reader reveals answers statically (D6).
 *
 * `NativeTopicReader` resolves to a throwing stub off-web, so the flag being false on
 * native is what keeps DOMPurify/marked/mermaid out of the native bundle (D3).
 */
export function TopicRenderer({ topic }: { topic: GeneratedTopic }) {
  if (USE_NATIVE_WEB_READER) return <NativeTopicReader topic={topic} />;
  return <IframeTopicRenderer topic={topic} />;
}

function IframeTopicRenderer({ topic }: { topic: GeneratedTopic }) {
  const html = useMemo(() => buildTopicHtml(topic), [topic]);
  return <HtmlView html={html} label="Topic content" />;
}
```

Note: `useMemo` moved into `IframeTopicRenderer` so the hook is not called before the early return.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/components/TopicRenderer.switch.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify nothing else regressed, and that native stays clean**

Run: `cd mobile && npx jest && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -F "src/reader/\|src/components/LessonRenderer" || echo "tsc clean"`
Expected: full suite PASS (including the existing `__tests__/components/LessonRenderer.test.tsx`), then `tsc clean`.

Then confirm the native bundle cannot reach the web-only libs:

Run: `cd mobile && grep -rn "dompurify\|from \"marked\"\|mermaid\|katex" src/ --include=*.ts --include=*.tsx | grep -v "\.web\.tsx" | grep -vE "^src/reader/(sanitize|markdown|enhance)\.ts" | grep -v "^src/types/katex-auto-render.d.ts"`
Expected: **no output**. Any hit means a web-only import leaked into a file metro will bundle for Android.

(`sanitize.ts`, `markdown.ts`, and `enhance.ts` are reachable only from `NativeTopicReader.web.tsx` — directly or via `renderContent.ts` — so they never enter the native graph. `NativeTopicReader.tsx`, the file metro *does* bundle for Android, imports none of them. Verify that by eye too.)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/LessonRenderer.tsx mobile/__tests__/components/TopicRenderer.switch.test.tsx
git commit -m "feat(reader): switch TopicRenderer to the native web reader behind the flag"
```

---

### Task 10: Delete the spike, verify on real books (spec D7)

The spike has been graduated; leaving it is dead code with a `/reader-lab` route. Then the manual verification D7 requires — this is the task that catches what tests cannot.

**Files:**
- Delete: `mobile/app/reader-lab.tsx`, `mobile/src/reader-lab/`
- Modify: `docs/superpowers/specs/2026-07-09-native-web-reader-design.md` (record the D7 verification result)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified parity report; the flag remains OFF.

- [ ] **Step 1: Delete the spike**

```bash
cd mobile && rm -rf src/reader-lab app/reader-lab.tsx
```

- [ ] **Step 2: Confirm nothing referenced it**

Run: `cd mobile && grep -rn "reader-lab" src/ app/ __tests__/ || echo "no references"`
Expected: `no references`.

- [ ] **Step 3: Full suite + typecheck**

Run: `cd mobile && npx jest && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error" | xargs -I{} echo "tsc errors (baseline ~529 env noise): {}"`
Expected: jest PASS. Coverage still ≥60% on all four metrics.

- [ ] **Step 4: Commit the deletion**

```bash
git add -A mobile/src/reader-lab mobile/app/reader-lab.tsx
git commit -m "chore(reader): delete the graduated reader-lab spike"
```

- [ ] **Step 5: Drive the real app with the flag ON**

The bundled library is the verification corpus. Fence counts, measured:

| Book | mermaid | animated svg | `$$` math |
|---|---|---|---|
| `claude-certified-architect-foundations` | 99 | 26 | 118 |
| `product-sense-and-ai` | 15 | 0 | 0 |

So `claude-certified-architect-foundations` is the only book that exercises all three. Use it.

```bash
cd mobile && EXPO_PUBLIC_NATIVE_READER=1 npx expo start --web
```

Open a topic of `claude-certified-architect-foundations` that contains an animated SVG figure, a mermaid diagram, and display math. Find one with:

```bash
cd mobile && python3 - <<'PY'
import json
d = json.load(open("assets/library/books/claude-certified-architect-foundations.book.json"))
for tid, t in (d.get("content") or {}).items():
    blob = json.dumps(t)
    if "```svg" in blob and "```mermaid" in blob:
        print(tid, "|", t.get("title"))
PY
```

Confirm, in the browser:
- [ ] Animated SVG figures **still animate** (`<animate>` / `<animateTransform>` survived the sanitizer). If any figure is static, run the D7 fallback in Step 6.
- [ ] Mermaid diagrams render. `securityLevel: "strict"` disables HTML labels — a diagram using them may look different from the iframe. Record any that do.
- [ ] Display and inline math render via KaTeX.
- [ ] Quiz answers show statically (expected — spec D6).
- [ ] Select text spanning the whole topic in one drag (the iframe could not).
- [ ] `Ctrl+F` finds a word from the middle of the topic (the iframe could not).
- [ ] `document.querySelectorAll("iframe").length === 0` in the console.
- [ ] Open the topic in the **shared-draft** reader (`/book/shared/<id>`) too — the switch is shared, so both routes must render.
- [ ] Compare side-by-side against the same topic with the flag off. Note any visual regression.

- [ ] **Step 6: D7 fallback — only if an animation was stripped**

If and only if a figure lost its animation, find out which tag DOMPurify removed. Do it
through the existing test infra (`sanitize.ts` is TypeScript — `node -e` cannot require it).
Add a temporary case to `mobile/__tests__/reader/sanitize.test.ts`:

```ts
// TEMPORARY diagnostic — delete once the dropped tag is identified.
// Asserts the real requirement (the figure keeps its animation), so it goes RED
// and names the tag rather than merely printing.
it.each(["animate", "animateTransform", "set", "animateMotion"])(
  "TEMP diagnostic — the failing figure keeps <%s>",
  (tag) => {
    const failing = `<svg>…paste the failing figure's markup here…</svg>`;
    const out = sanitizeFragment(failing);
    if (!new RegExp(`<${tag}[\\s/>]`, "i").test(failing)) return; // figure doesn't use it
    expect(new RegExp(`<${tag}[\\s/>]`, "i").test(out)).toBe(true);
  },
);
```

Run: `cd mobile && npx jest __tests__/reader/sanitize.test.ts -t "TEMP diagnostic"`
The RED case names the dropped tag.

Then add **only that animation tag** to `ANIMATION_TAGS` in `src/reader/sanitize.ts`, add a
permanent keep-test for it, and add a paired attack test proving the `attributeName="href"`
vector stays closed for that tag too. Delete the temporary diagnostic. Never add `on*`,
`<script>`, or `<foreignObject>` (Global Constraint 3).

- [ ] **Step 7: Record the verification in the spec**

Append to `docs/superpowers/specs/2026-07-09-native-web-reader-design.md` under a new `## D7 verification (2026-07-10)` heading: which book/topic was driven, which of the checks in Step 5 passed, any mermaid `strict`-mode differences, and whether the fallback in Step 6 was needed. State plainly if something failed — a green test suite is not evidence the reader works.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-07-09-native-web-reader-design.md
git commit -m "docs(spec): record the D7 real-book verification for the native web reader"
```

---

## Done means

- `npx jest` green in `mobile/`, coverage ≥60% on all four metrics.
- `npx tsc --noEmit` introduces no new errors in `src/reader/` or `src/components/LessonRenderer.tsx`.
- The grep in Task 9 Step 5 returns nothing (no web-only import in the native graph).
- `EXPO_PUBLIC_NATIVE_READER` unset ⇒ the web app renders the sandboxed iframe exactly as it does on `main` today. **No user-visible change ships from this plan.**
- The D7 verification is recorded in the spec, including any failure.

## Explicitly NOT in this plan

- Flipping the flag's default (spec D1 — gated on the interactive-reveal fast-follow).
- Interactive quiz reveal (spec D6 fast-follow).
- Retiring the iframe, on web or native.
- SEO/SSR, or a separate `mentible-web` Next.js repo.
- Any backend, auth, or billing change.
- Hardening `react-native-webview`'s `originWhitelist={["*"]}` (a recorded, lower-severity follow-up).
