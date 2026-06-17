// Global text-font interceptor (native only).
//
// React Native has no global font and won't synthesize weight from static bundled
// fonts, so rather than edit ~120 style sites we patch Text/TextInput once to inject
// the right family per render (see src/constants/fonts for the why). Each render
// starts from the component's own JSX style, so this neither accumulates nor mutates
// source styles.
//
// Rules (per element, from its flattened style):
//   • monospace fields (BYOK key / code) are left untouched
//   • explicit serif intent ("serif"/"Georgia") OR large+bold text → heading (serif)
//   • everything else → body (Inter)
//   • dyslexic mode overrides all of the above → OpenDyslexic
//
// On web we do nothing: the theme's CSS font stacks + real fontWeight already work.
import React from "react";
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { resolveFamily, type FontRole } from "@/constants/fonts";
import { isDyslexic } from "@/state/fontMode";

// Heading heuristic: titles in this app are >= sizeXl (22) and semibold/bold. Body
// text never hits both, so this reliably separates the two without per-screen markers.
const HEADING_MIN_SIZE = 22;

const MONO_RE = /mono|menlo|jetbrains/i;
const SERIF_RE = /serif|georgia/i;

function isBoldish(weight: unknown): boolean {
  if (weight === "bold") return true;
  const n = typeof weight === "number" ? weight : parseInt(String(weight ?? "400"), 10);
  return !Number.isNaN(n) && n >= 600;
}

function familyFor(style: unknown): string | null {
  const flat = (StyleSheet.flatten(style as never) ?? {}) as {
    fontFamily?: string;
    fontWeight?: string | number;
    fontSize?: number;
  };
  // Preserve deliberate monospace (key field, code).
  if (flat.fontFamily && MONO_RE.test(flat.fontFamily)) return null;

  let role: FontRole = "body";
  if (flat.fontFamily && SERIF_RE.test(flat.fontFamily)) role = "heading";
  else if ((flat.fontSize ?? 0) >= HEADING_MIN_SIZE && isBoldish(flat.fontWeight)) role = "heading";

  return resolveFamily(role, flat.fontWeight, isDyslexic());
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
