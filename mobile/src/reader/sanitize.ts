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
