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
