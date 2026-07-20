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

// ---------------------------------------------------------------------------
// CSS/style/srcset/SVG-paint fetch-channel closure (ported from the Open
// Shelves F1 chapter sanitizer's `makeChapterSanitizeHook` design — see
// `git show feat/open-shelves:mobile/src/reader/sanitize.ts` for the full
// rationale trail). Generated topic content and shared drafts (ADR-027) are
// untrusted the same way an imported chapter is; the only difference is that
// a topic has no per-book image map, so `src` reduces to the same
// data:-or-drop rule as every other URI attribute below instead of resolving
// through a map first.

// Attributes whose value is a BARE URI (not a CSS `url(...)` — see
// PAINT_ATTRS below for those). Each survives only as a `data:` URI. See the
// F1 blueprint for why `cite`/`color-profile`/`background` are listed even
// though some are collateral, and why `srcset` is deliberately absent (it is
// dropped wholesale via HOOKLESS_FORBID_ATTR instead — a candidate LIST is
// the wrong shape for a single-URI data:-or-drop test).
const URI_ATTRS = [
  "src", "href", "poster", "data", "xlink:href", "background",
  "cite", "color-profile",
] as const;

// Attributes the hook does NOT screen because they are removed outright
// before it ever runs: `style` is an entire CSS surface (unscreenable by a
// token blocklist — image-set()/var()/CSS-escapes all defeat a `url()` regex);
// `srcset` is a candidate list, the wrong shape for a single-URI test. MUST be
// forbidden at every sanitize entry point, including the nested
// `sanitizeSvgDataUri` re-sanitize, or the surface reopens one level down.
const HOOKLESS_FORBID_ATTR = ["style", "srcset"] as const;

// SVG paint attributes whose value is a CSS property accepting a `url(...)`
// reference. DOMPurify's default svg profile permits every one of them and
// screens none — `fill`, `filter`, `mask`, `clip-path` all verified as live
// fetch channels for a non-`#` url(). These are ALLOWLISTED by
// `isSafePaintValue`, not blocklisted: `url(#g)` same-document gradients are
// real, common markup that must survive.
const PAINT_ATTRS = [
  "fill", "stroke", "filter", "mask", "clip-path",
  "marker-start", "marker-mid", "marker-end",
] as const;

// Bounds recursion into nested `data:image/svg+xml` documents (an SVG can
// embed another SVG data: URI inside its own `<image href>`).
const MAX_SVG_DEPTH = 4;

function isDataUri(v: string | null): v is string {
  return typeof v === "string" && /^\s*data:/i.test(v);
}

// A `#fragment`-only href is resolved same-document and cannot cause a
// network request. `#` must be the FIRST character: `https://evil.example/#x`
// is a real network URI that merely ends in a fragment, and must not match.
function isFragmentOnlyHref(v: string | null): v is string {
  return typeof v === "string" && v.charAt(0) === "#";
}

// ONE safe paint token: a keyword, a hex colour, a number/percentage, or a
// numeric colour function whose arguments admit digits and separators ONLY —
// never a string, never a nested function, never anything URL-shaped.
function isSafePaintToken(t: string): boolean {
  return (
    /^[A-Za-z][A-Za-z-]*$/.test(t) ||
    /^#[0-9A-Fa-f]{3,8}$/.test(t) ||
    // The fractional part sits BEHIND a required '.', so a digit run has exactly
    // one parse — avoids the quadratic backtrack of `\d+\.?\d*`.
    /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(t) ||
    /^(?:rgba?|hsla?)\([\d.,%\s/+-]+\)$/i.test(t)
  );
}

// True when an SVG paint attribute's value is one we RECOGNISE as safe. This
// is an ALLOWLIST: anything not positively matched here is refused. See the
// F1 blueprint for the full rationale (image-set()/var()/CSS-escape defeat
// any blocklist; there is no complete list of what's dangerous in CSS, but
// there IS a short, complete list of what a paint attribute legitimately
// contains).
function isSafePaintValue(v: string | null): boolean {
  if (typeof v !== "string") return false;
  if (v.indexOf("\\") !== -1) return false; // any CSS escape — refuse outright
  const s = v.trim();
  if (s === "") return true; // an empty value cannot fetch

  const m = /^url\(\s*(?:"([^"'()\\<>\s]+)"|'([^"'()\\<>\s]+)'|([^"'()\\<>\s]+))\s*\)/i.exec(s);
  if (!m) return isSafePaintToken(s);

  const ident = m[1] ?? m[2] ?? m[3];
  if (ident.charAt(0) !== "#") return false; // a url() that is not same-document
  const rest = s.slice(m[0].length).trim();
  return rest === "" || isSafePaintToken(rest);
}

// btoa/atob only handle Latin1 — this pair round-trips arbitrary UTF-8 SVG
// text (accented captions, non-Latin scripts) through them safely.
function utf8ToBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Builds the `afterSanitizeAttributes` hook that turns DOMPurify into the
 * no-network enforcement point for generated topic / shared-draft content:
 *
 *   - every bare-URI attribute (including `src`) survives only as a `data:`
 *     URI — topics have no per-book image map to resolve against, so `src`
 *     follows the same data:-or-drop rule as everything else in `URI_ATTRS`
 *   - a `data:` URI can BE A DOCUMENT: any surviving `image/svg+xml` payload
 *     is decoded and re-sanitized as its own document (recursively, up to
 *     `MAX_SVG_DEPTH`), then re-encoded
 *   - keeps an SVG paint attribute ONLY when its value matches the safe
 *     grammar in `isSafePaintValue`
 *
 * `style` and `srcset` are NOT handled here — dropped wholesale by
 * `HOOKLESS_FORBID_ATTR` before this hook runs.
 */
export function makeTopicSanitizeHook(
  purify: Pick<typeof DOMPurify, "sanitize">,
): (node: Element) => void {
  let svgDepth = 0;

  function sanitizeSvgDataUri(uri: string): string | null {
    const m = /^\s*data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(uri);
    if (!m) return null;
    if (svgDepth >= MAX_SVG_DEPTH) return null; // refuse rather than recurse further
    let svgText: string;
    try {
      svgText = m[1] ? base64ToUtf8(m[2]) : decodeURIComponent(m[2]);
    } catch {
      return null; // malformed payload — refuse rather than pass raw bytes through
    }
    svgDepth++;
    let clean: string;
    try {
      clean = purify.sanitize(svgText, {
        USE_PROFILES: { svg: true },
        FORBID_TAGS: ["script", "foreignObject", "style"],
        // This nested call passes its OWN config, so the wholesale drops do not
        // inherit from SANITIZE_CONFIG — without this the `style` surface
        // simply reopens one level down inside a data: URI. `xlink:href` is
        // deliberately NOT forbidden here: it is how a nested SVG legitimately
        // carries a data: image, and the hook (which DOES re-enter on this
        // call) screens it data:-only.
        FORBID_ATTR: [...HOOKLESS_FORBID_ATTR],
      }) as unknown as string;
    } finally {
      svgDepth--;
    }
    if (!clean) return null;
    try {
      return `data:image/svg+xml;base64,${utf8ToBase64(clean)}`;
    } catch {
      return null; // encode failure — refuse rather than ship a mangled src
    }
  }

  return function topicSanitizeHook(node: Element): void {
    if (!node.hasAttribute) return;

    for (const attr of URI_ATTRS) {
      if (!node.hasAttribute(attr)) continue;
      const val = node.getAttribute(attr);
      if (attr === "href" && isFragmentOnlyHref(val)) continue; // same-document, no network
      if (!isDataUri(val)) {
        node.removeAttribute(attr);
        continue;
      }
      if (/^\s*data:image\/svg\+xml/i.test(val)) {
        const safe = sanitizeSvgDataUri(val);
        if (safe) node.setAttribute(attr, safe);
        else node.removeAttribute(attr);
      }
    }

    for (const attr of PAINT_ATTRS) {
      if (!node.hasAttribute(attr)) continue;
      if (!isSafePaintValue(node.getAttribute(attr))) node.removeAttribute(attr);
    }

    // NOTE: there is no `style` screen here — the attribute is dropped
    // wholesale via HOOKLESS_FORBID_ATTR before this hook runs. See that
    // constant for why CSS cannot be screened by a token blocklist. Do not
    // reintroduce one.
  };
}

export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  ADD_TAGS: ANIMATION_TAGS,
  ADD_ATTR: ANIMATION_ATTRS,
  // Belt and braces: the profiles above already exclude these. Listed explicitly
  // so the intent survives a profile change. NEVER remove an entry to fix a render.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "foreignObject", "style"],
  FORBID_ATTR: ["srcdoc", "formaction", "xlink:href", ...HOOKLESS_FORBID_ATTR],
};

/** Untrusted HTML → HTML safe to inject into the app document. */
export function sanitizeFragment(html: string): string {
  const hook = makeTopicSanitizeHook(DOMPurify);
  DOMPurify.addHook("afterSanitizeAttributes", hook);
  try {
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as unknown as string;
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", hook);
  }
}

// ---------------------------------------------------------------------------
// Imported chapters (Open Shelves F1) — the no-network enforcement boundary.
//
// An imported chapter's HTML is raw and untouched (import has no DOM to
// rewrite it with safely — see `@/openshelves/epubImages`). This is the ONE
// place, on web, that walks the real parsed DOM DOMPurify builds and enforces
// two things a sanitizer's default config does not: (1) every image reference
// is resolved from the chapter's own image map or the element is dropped —
// DOMPurify's default config has no reason to touch `<img src="https://…">`,
// remote images are unremarkable markup; (2) every other URI-bearing
// attribute survives only if it is already a `data:` URI.
//
// This EXACT algorithm is re-authored, not shared via import, as a literal
// string inside `@/components/contentHtml`'s WebView document — the WebView
// cannot import bundle modules (Hermes has no DOM to run this file on in the
// first place). `__tests__/reader/chapterSanitizeVectors.ts` drives both
// copies over one vector table so they cannot silently drift apart.

export type ChapterImageMap = Record<string, string>;

// Attributes whose value is a BARE URI (not a CSS `url(...)` — see
// CHAPTER_PAINT_ATTRS below for those). Each survives only as a `data:` URI.
//
// 'background': a legacy presentational attribute (WHATWG "non-conforming
// features") that Chromium/WebView maps to CSS `background-image` and
// FETCHES — permitted by DOMPurify's default html profile on any allowed
// element (table/tbody/thead/tfoot/tr/td/th among them), unscreened by any
// other check here.
//
// NOTE on what "data:-only" actually means per attribute — the rule this list
// applies is uniform, but what REACHES it is not. DOMPurify's
// `_isValidAttribute` only exempts `data:` for `src`/`href`/`xlink:href` on its
// DATA_URI_TAGS (audio,video,img,source,image,track); for every other
// attribute a `data:` value is dropped by DOMPurify's core BEFORE this hook
// runs. So `background="data:…"` and `poster="data:…"` never survive to be
// screened here — they are already gone (verified by execution, not assumed:
// `chapterSanitize.test.ts` pins it). That fails SAFE, so listing them is
// belt-and-braces rather than the thing doing the work; only `src` (and `href`
// on the DATA_URI_TAGS) genuinely reaches the data:-only branch below.
//
// 'cite' (blockquote/q/del/ins) and 'color-profile' are URI-bearing and
// DOMPurify-default-allowed, but are NOT fetch channels in any current engine —
// no mainstream browser dereferences `cite`, and `color-profile` was removed in
// SVG 2 and never implemented for external profiles. They are listed to keep
// the invariant uniform ("every URI-bearing attribute reduces to data:-only"),
// not because they leak today. `color-profile="sRGB"` is dropped as collateral;
// that is a dead property, so the render cost is nil.
//
// 'srcset' is deliberately ABSENT — it is dropped wholesale via FORBID_ATTR
// instead. See CHAPTER_HOOKLESS_FORBID_ATTR below for why a data:-or-drop test
// is structurally the wrong shape for it.
const CHAPTER_URI_ATTRS = [
  "src", "href", "poster", "data", "xlink:href", "background",
  "cite", "color-profile",
] as const;

// Attributes the hook does NOT screen, because they are removed outright before
// it ever runs. Both are surfaces we deleted rather than tried to screen:
//
//   'style' — an ENTIRE CSS surface, and CSS is not screenable by a token
//     blocklist. Round 4 defeated the day-one `url()` regex three independent
//     ways, all verified as real fetches in Chromium 150: `image-set('https://…')`
//     (a fetching function taking a BARE STRING — no `url(` token exists at
//     all), CSS escapes (`\75 rl(` IS `url(`, so the token is never literally
//     present), and `var()` indirection — the URL sits in a custom property as
//     a plain quoted string while the declaration that fetches it contains NO
//     fetching token whatsoever. That last one is the proof of impossibility:
//     the URL and the fetch live in different attributes, and neither, read
//     alone, is matchable. Any further token added to a pattern is the same
//     trap a fifth time.
//     Dropping it is SPEC-ALIGNED, not a new restriction: spec D-I3 already
//     drops the EPUB's CSS ("our typography, images kept, EPUB CSS dropped")
//     and FORBID_TAGS already kills the <style> ELEMENT. The surviving `style`
//     ATTRIBUTE was the inconsistency. Cost, accepted and pinned by vectors:
//     benign `style="color:#333"` no longer survives.
//
//   'srcset' — a candidate LIST, so a single-URI test is the wrong SHAPE for
//     it: `isDataUri` is /^\s*data:/i and only inspects the START of the value,
//     so `srcset="data:… 1x, https://evil… 2x"` would pass the hook's
//     data:-or-drop check with the remote candidate intact. It survives today
//     only by ACCIDENT — DOMPurify's core drops it first (IS_ALLOWED_URI fails
//     on the leading `data:`, and `srcset` is not `src`/`href` on a
//     DATA_URI_TAG). Verified by execution: adding `ADD_URI_SAFE_ATTR:
//     ['srcset']` — one config line — makes the hook keep the remote candidate
//     and turns this into a live leak. An imported chapter has no need for
//     srcset; its images resolve from the `images` map via `src`.
//
// MUST be forbidden at EVERY sanitize entry point, including the nested
// `sanitizeSvgDataUri` re-sanitize (which passes its own config) — otherwise
// the surface simply reopens one level down.
const CHAPTER_HOOKLESS_FORBID_ATTR = ["style", "srcset"] as const;

// SVG paint attributes whose value is a CSS property accepting a `url(...)`
// reference. DOMPurify's default `svg` profile permits every one of them and
// screens none: `_isValidAttribute` tests values against IS_ALLOWED_URI, which
// only recognises a value as URI-shaped when it begins with a bare `scheme:`.
// `fill="url(https://…)"` begins with `url(`, so it falls into that regex's
// "not a URI, therefore inert" branch and passes through verbatim.
//
// THESE ARE A REAL FETCH CHANNEL — corrected here because fix #3's comment
// claimed otherwise ("No engine resolves external paint servers anyway, so the
// exemption would buy nothing"). That premise was FALSE. Round 4 verified in
// Chromium 150, against a local hit-logging server, that `fill`, `filter`,
// `mask` and `clip-path` set to `url(/hit/external-*.svg#id)` ALL fetch. So
// fix #3 closed a LIVE leak, not a theoretical one, and this screen is
// load-bearing. The decision it justified was right; only its stated reason was
// wrong — and a security comment resting on a false premise is exactly what
// talks a future maintainer into relaxing the screen. It is restated here as
// what is actually true.
//
// These are ALLOWLISTED by `isSafePaintValue` (below), not blocklisted. Fix #3
// screened them by hunting for a non-`#` `url(` token; Round 4 walked past that
// with `image-set('https://…')` (no `url(` token at all) and with CSS escapes
// (`\75 rl(` IS `url(`), on these very attributes — the same three mechanisms
// that killed the `style` regex. `style` had no safe subset worth keeping so it
// was deleted outright; these DO have one (`url(#g)` is how essentially every
// real gradient is authored), so the answer here is to enumerate what is SAFE
// and refuse the rest.
//
// Enumerated by intersecting DOMPurify's REAL default svg attribute list with
// the SVG/CSS properties whose grammar admits a <FuncIRI>. `cursor`, `marker`
// (the shorthand) and `mask-image` also take url() but are NOT in DOMPurify's
// allowed set, so they cannot appear. `color-profile` is the one URI-bearing
// straggler whose grammar is a bare <iri> rather than url() — a url() screen
// could never fire on it, so it lives on CHAPTER_URI_ATTRS above instead.
const CHAPTER_PAINT_ATTRS = [
  "fill", "stroke", "filter", "mask", "clip-path",
  "marker-start", "marker-mid", "marker-end",
] as const;

// The chapter hook reuses the module-level SVG/paint helpers defined above for
// the topic hook — `MAX_SVG_DEPTH`, `isDataUri`, `isFragmentOnlyHref`,
// `isSafePaintToken`, `isSafePaintValue`, `utf8ToBase64`, `base64ToUtf8`. Open
// Shelves F1 and the #329 topic hardening each ported an identical copy from the
// same F1 blueprint; the F1↔topic merge converged them to one definition (the
// R4 "converge chapter+topic primitives" note). Only the chapter-specific
// `CHAPTER_HOOKLESS_FORBID_ATTR` / `CHAPTER_PAINT_ATTRS` and the per-book image
// map remain distinct to the chapter path.

/**
 * Builds the `afterSanitizeAttributes` hook that turns DOMPurify into the
 * no-network enforcement point for one imported chapter (spec D-I4/D-I6):
 *
 *   - swaps a resolvable `src` for its `data:` URI from `images`
 *   - drops the WHOLE element when `src` has no map entry and isn't already a
 *     `data:` URI — `chapterImageMap` silently omits oversize/unknown-mime
 *     images, so a lookup miss is normal and must not degrade to "leave the
 *     original src alone"
 *   - strips every other bare-URI attribute unless it is a `data:` URI
 *   - a `data:` URI can BE A DOCUMENT: any surviving `image/svg+xml` payload
 *     is decoded and sanitized as its own document (same hook applies to its
 *     contents too, recursively, up to `MAX_SVG_DEPTH`), then re-encoded
 *   - keeps an SVG paint attribute (`fill`, `stroke`, `filter`, `mask`,
 *     `clip-path`, `marker-*`) ONLY when its value matches the safe grammar in
 *     `isSafePaintValue` — a paint server is a fetch channel too, and
 *     DOMPurify's IS_ALLOWED_URI never sees a `url(`-prefixed value as a URI.
 *     This is an allowlist: unrecognised values are refused, not inspected.
 *
 * The `style` attribute and `srcset` are NOT handled here — they are dropped
 * wholesale by `CHAPTER_HOOKLESS_FORBID_ATTR` before this hook runs. See that
 * constant; do not reintroduce a screen for either.
 *
 * `purify` is passed in (not the module import used directly) so the native
 * WebView's re-authored copy of this function can call the SAME algorithm
 * against ITS OWN inlined DOMPurify instance — the two copies differ only in
 * where `DOMPurify`/`atob`/`btoa` come from, never in the logic itself.
 */
export function makeChapterSanitizeHook(
  images: ChapterImageMap,
  purify: Pick<typeof DOMPurify, "sanitize">,
): (node: Element) => void {
  let svgDepth = 0;

  function sanitizeSvgDataUri(uri: string): string | null {
    const m = /^\s*data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(uri);
    if (!m) return null;
    if (svgDepth >= MAX_SVG_DEPTH) return null; // refuse rather than recurse further
    let svgText: string;
    try {
      svgText = m[1] ? base64ToUtf8(m[2]) : decodeURIComponent(m[2]);
    } catch {
      return null; // malformed payload — refuse rather than pass raw bytes through
    }
    svgDepth++;
    let clean: string;
    try {
      clean = purify.sanitize(svgText, {
        USE_PROFILES: { svg: true },
        FORBID_TAGS: ["script", "foreignObject", "style"],
        // This nested call passes its OWN config, so the wholesale drops do not
        // inherit from CHAPTER_SANITIZE_CONFIG — without this the `style`
        // surface simply reopens one level down inside a data: URI (Round 4
        // found exactly that: an `image-set()` in a nested payload's style
        // attribute, intact). `xlink:href` is deliberately NOT forbidden here:
        // it is how a nested SVG legitimately carries a data: image, and the
        // hook (which DOES re-enter on this call) screens it data:-only.
        FORBID_ATTR: [...CHAPTER_HOOKLESS_FORBID_ATTR],
      }) as unknown as string;
    } finally {
      svgDepth--;
    }
    if (!clean) return null;
    try {
      return `data:image/svg+xml;base64,${utf8ToBase64(clean)}`;
    } catch {
      return null; // encode failure — refuse rather than ship a mangled src
    }
  }

  return function chapterSanitizeHook(node: Element): void {
    if (!node.hasAttribute) return;

    if (node.hasAttribute("src")) {
      const src = node.getAttribute("src");
      const mapped =
        src !== null && Object.prototype.hasOwnProperty.call(images, src) ? images[src] : undefined;
      if (mapped !== undefined) {
        node.setAttribute("src", mapped);
      } else if (!isDataUri(src)) {
        node.parentNode?.removeChild(node);
        return;
      }
    }

    for (const attr of CHAPTER_URI_ATTRS) {
      if (!node.hasAttribute(attr)) continue;
      const val = node.getAttribute(attr);
      if (attr === "href" && isFragmentOnlyHref(val)) continue; // same-document, no network
      if (!isDataUri(val)) {
        node.removeAttribute(attr);
        continue;
      }
      if (/^\s*data:image\/svg\+xml/i.test(val)) {
        const safe = sanitizeSvgDataUri(val);
        if (safe) node.setAttribute(attr, safe);
        else node.removeAttribute(attr);
      }
    }

    for (const attr of CHAPTER_PAINT_ATTRS) {
      if (!node.hasAttribute(attr)) continue;
      if (!isSafePaintValue(node.getAttribute(attr))) node.removeAttribute(attr);
    }

    // NOTE: there is no `style` screen here any more, by design. The attribute
    // is dropped wholesale via CHAPTER_HOOKLESS_FORBID_ATTR before this hook
    // runs — see that constant for why CSS cannot be screened by a token
    // blocklist. Do not reintroduce one.
  };
}

export const CHAPTER_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true },
  // 'style': a <style> ELEMENT's text content is raw CSS that DOMPurify's
  // default config does not inspect at all — `@import` and `background:
  // url(...)` inside a <style> block are both live network/exfiltration
  // channels DOMPurify's own guidance says to forbid for untrusted CSS. An
  // imported chapter has no legitimate need for a raw <style> block; the
  // EPUB's own CSS is dropped by design (spec D-I3). The `style` ATTRIBUTE is
  // now dropped for the same reason, via FORBID_ATTR below.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "foreignObject", "style"],
  FORBID_ATTR: ["srcdoc", "formaction", "xlink:href", ...CHAPTER_HOOKLESS_FORBID_ATTR],
};

/**
 * Untrusted, third-party chapter HTML (Open Shelves import) → HTML safe to
 * inject into the app document, with every image reference resolved from
 * `images` or dropped, and every other network-capable reference removed.
 * See `makeChapterSanitizeHook`.
 *
 * The hook is added and removed around exactly this one call — `DOMPurify`
 * here is the shared module singleton also used by `sanitizeFragment` for
 * generated topics, and a hook left attached would apply chapter rules (and
 * this chapter's `images` map) to unrelated content sanitized afterwards.
 */
export function sanitizeImportedChapterHtml(html: string, images: ChapterImageMap): string {
  const hook = makeChapterSanitizeHook(images, DOMPurify);
  DOMPurify.addHook("afterSanitizeAttributes", hook);
  try {
    return DOMPurify.sanitize(html, CHAPTER_SANITIZE_CONFIG) as unknown as string;
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", hook);
  }
}
