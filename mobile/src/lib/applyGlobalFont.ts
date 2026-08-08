// Global text-font interceptor (native only).
//
// React Native has no global font and won't synthesize weight from static bundled
// fonts, so rather than edit ~120 style sites we patch Text/TextInput once to inject
// the right family per render (see src/constants/fonts for the why). Each render
// starts from the component's own JSX style, so this neither accumulates nor mutates
// source styles.
//
// Rules (per element, from its flattened style):
//   • an explicit fontFamily is LEFT UNTOUCHED — except our serif text-intent
//     ("serif"/"Georgia"), which is remapped to the bundled serif. This is what
//     keeps ICON FONTS (Ionicons, Material…) and monospace (key/code) working:
//     overriding "Ionicons" with a text font renders the glyph codepoints as tofu
//     / CJK characters instead of icons.
//   • no explicit family → body (Inter), or heading (serif) if it's large+bold
//   • dyslexic mode swaps the text families (body/heading) to OpenDyslexic, but
//     still never touches an unrecognised explicit family (icons stay icons)
//
// On web we do nothing: the theme's CSS font stacks + real fontWeight already work.
import React from "react";
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { resolveFamily } from "@/constants/fonts";
import { isDyslexic } from "@/state/fontMode";

// Heading heuristic: titles in this app are >= sizeXl (22) and semibold/bold. Body
// text never hits both, so this reliably separates the two without per-screen markers.
const HEADING_MIN_SIZE = 22;

// Our serif text-intent on native (theme.fontHeading resolves to these). Anything
// else with an explicit family — icon sets, "monospace" — is deliberately skipped.
const SERIF_RE = /serif|georgia/i;

// Fraunces is the SME/Navy-Trust heading brand (ADR-038 O2). SME heading styles
// set a concrete Fraunces_* family; recognising it here as heading-intent means
// dyslexic mode still overrides it (a11y) instead of leaving it untouched.
const FRAUNCES_RE = /fraunces/i;

// Playfair Display is the app-wide heading face (Studio reskin P0). A literal
// PlayfairDisplay_* family is heading-intent: keep the exact instance the style
// chose, but still honour dyslexic mode (a11y wins over the brand face).
const PLAYFAIR_RE = /playfair/i;

// A concrete Fraunces/Playfair family already bakes its weight into the name
// (e.g. "Fraunces_700Bold", "PlayfairDisplay_600SemiBold"), so we read the
// weight from the NAME rather than the style's fontWeight. That lets migrated
// heading styles omit fontWeight entirely — which they must, so web (where this
// interceptor doesn't run) doesn't synthesise faux-bold from a redundant
// fontWeight on a weight-400-registered @font-face. Shared by both branches
// below (pure family-name → weight extractor; not Fraunces-specific).
function weightFromFamily(family: string): string | undefined {
  return /_(\d{3})/.exec(family)?.[1];
}

function isBoldish(weight: unknown): boolean {
  if (weight === "bold") return true;
  const n = typeof weight === "number" ? weight : parseInt(String(weight ?? "400"), 10);
  return !Number.isNaN(n) && n >= 600;
}

// Decide the family to inject for a flattened style, or null to leave it untouched.
// Pure + exported so the icon-font / monospace / heading rules are unit-tested.
export function resolveFamilyForStyle(style: unknown, dyslexic: boolean): string | null {
  const flat = (StyleSheet.flatten(style as never) ?? {}) as {
    fontFamily?: string;
    fontWeight?: string | number;
    fontSize?: number;
  };

  if (flat.fontFamily) {
    // The SME Fraunces heading brand (upright headings + the italic accent word):
    // keep the exact instance the style chose, but still honour dyslexic mode
    // (OpenDyslexic by the weight baked into the family — it has no italic, so the
    // a11y font wins over the accent slant).
    if (FRAUNCES_RE.test(flat.fontFamily)) {
      if (dyslexic) return resolveFamily("heading", weightFromFamily(flat.fontFamily), true, "fraunces");
      return flat.fontFamily;
    }
    // A literal Playfair family (the app-wide heading face): keep the exact
    // instance the style chose, but dyslexic mode still overrides it (a11y).
    // Like Fraunces, the concrete Playfair family bakes its weight into the name
    // (e.g. "PlayfairDisplay_600SemiBold") and migrated heading styles set NO
    // fontWeight — so read the weight from the family name first, falling back to
    // flat.fontWeight only if the name doesn't carry one.
    if (PLAYFAIR_RE.test(flat.fontFamily)) {
      if (dyslexic) {
        return resolveFamily("heading", weightFromFamily(flat.fontFamily) ?? flat.fontWeight, true);
      }
      return flat.fontFamily;
    }
    // Only our serif text-intent gets remapped; every other explicit family
    // (icon sets, "monospace", a deliberate family) is left exactly as-is.
    if (SERIF_RE.test(flat.fontFamily)) return resolveFamily("heading", flat.fontWeight, dyslexic);
    return null;
  }

  const role =
    (flat.fontSize ?? 0) >= HEADING_MIN_SIZE && isBoldish(flat.fontWeight) ? "heading" : "body";
  return resolveFamily(role, flat.fontWeight, dyslexic);
}

function familyFor(style: unknown): string | null {
  return resolveFamilyForStyle(style, isDyslexic());
}

function patch(Component: { render?: (...args: unknown[]) => unknown }) {
  const orig = Component.render;
  if (typeof orig !== "function" || (orig as { __mentibleFontPatched?: boolean }).__mentibleFontPatched) {
    return;
  }
  const patched = function (this: unknown, ...args: unknown[]) {
    const element = orig.apply(this, args) as React.ReactElement<{ style?: unknown }> | null;
    if (!element || !element.props) return element;
    const family = familyFor(element.props.style);
    if (!family) return element;
    // Append our family so it overrides the family + weight while preserving the
    // element's own colour/size; the weight is baked into the family name.
    return React.cloneElement(element, {
      style: [element.props.style, { fontFamily: family, fontWeight: "normal" as const }],
    });
  };
  (patched as { __mentibleFontPatched?: boolean }).__mentibleFontPatched = true;
  Component.render = patched;
}

// Install once at startup (before first paint). No-op on web.
export function applyGlobalFont(): void {
  if (Platform.OS === "web") return;
  patch(Text as unknown as { render?: (...args: unknown[]) => unknown });
  patch(TextInput as unknown as { render?: (...args: unknown[]) => unknown });
}
