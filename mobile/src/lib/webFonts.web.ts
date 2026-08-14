// Web-only: register CANONICAL, weight-synthesizing @font-face families from
// the already-bundled font module assets, and make Inter the default text
// font.
//
// Why this exists (see docs/superpowers/specs/2026-08-14-web-fonts-design.md):
// `expo-font`'s useFonts(FONT_ASSETS) (app/_layout.tsx) registers each bundled
// weight as its OWN family — "Inter_400Regular", "Fraunces_700Bold", … — never
// a family literally named "Inter" or "Fraunces". But the theme's WEB font
// stacks (src/constants/theme.ts `fontHeading`/`fontBody`) name the CANONICAL
// family ("Inter, system-ui, …", "'Source Serif 4', … serif"), so on web those
// stacks fall through to the browser's system font. This module closes that
// gap by declaring the canonical names ourselves, each weight pointing at the
// SAME bundled font file expo-font already ships — the browser then
// synthesizes the right face from font-weight, same as it would for any real
// variable/static web font family.
//
// applyGlobalFont (native-only interceptor) skips web entirely (an explicit
// `if (Platform.OS === "web") return`), NOT because its patch mechanism fails
// there — react-native-web's Text/TextInput are forwardRef components that
// expose the same patchable `.render`. The @font-face + inheritance-only
// default rule above can't beat RNW's per-Text reset class (same (0,1,0)
// specificity, and the reset directly matches while our rule only inherits —
// see the DEFAULT_TEXT_RULE comment for the full empirical trail), so
// installWebTextFontInterceptor (below) resolves the family in JS and adds it
// to the element's `style`, which RNW turns into a second, directly-matching
// atomic class that wins over the reset class. This closes the residual gap
// noted above (un-styled top-level Text staying on the system stack). It
// deliberately does NOT mirror applyGlobalFont's wrap-the-output shape — see
// the comment on patchWebText for why RNW needs the opposite (wrap the
// INPUT).
import { Asset } from "expo-asset";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Fraunces_400Regular,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold_Italic,
} from "@expo-google-fonts/fraunces";
import {
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from "@expo-google-fonts/source-serif-4";
import { Text, TextInput } from "react-native";
import { resolveFamilyForStyle } from "@/lib/applyGlobalFont";
import { isDyslexic } from "@/state/fontMode";
import { studioLightColors } from "@/constants/theme";

const STYLE_ID = "mentible-web-fonts";

type FaceSpec = {
  family: string;
  weight: 400 | 500 | 600 | 700;
  style?: "italic";
  mod: Parameters<typeof Asset.fromModule>[0];
};

// Same require() pattern as src/constants/fonts.ts for the vendored ttf assets.
const OpenDyslexic_400Regular = require("../../assets/fonts/OpenDyslexic-Regular.ttf");
const OpenDyslexic_700Bold = require("../../assets/fonts/OpenDyslexic-Bold.ttf");

const FACES: FaceSpec[] = [
  { family: "Inter", weight: 400, mod: Inter_400Regular },
  { family: "Inter", weight: 500, mod: Inter_500Medium },
  { family: "Inter", weight: 600, mod: Inter_600SemiBold },
  { family: "Inter", weight: 700, mod: Inter_700Bold },
  { family: "Fraunces", weight: 400, mod: Fraunces_400Regular },
  { family: "Fraunces", weight: 600, mod: Fraunces_600SemiBold },
  { family: "Fraunces", weight: 700, mod: Fraunces_700Bold },
  { family: "Fraunces", weight: 400, style: "italic", mod: Fraunces_400Regular_Italic },
  { family: "Fraunces", weight: 600, style: "italic", mod: Fraunces_600SemiBold_Italic },
  { family: "Source Serif 4", weight: 400, mod: SourceSerif4_400Regular },
  { family: "Source Serif 4", weight: 600, mod: SourceSerif4_600SemiBold },
  { family: "Source Serif 4", weight: 700, mod: SourceSerif4_700Bold },
  { family: "OpenDyslexic", weight: 400, mod: OpenDyslexic_400Regular },
  { family: "OpenDyslexic", weight: 700, mod: OpenDyslexic_700Bold },
];

function faceRule(spec: FaceSpec): string {
  const uri = Asset.fromModule(spec.mod).uri;
  return [
    "@font-face {",
    `  font-family: "${spec.family}";`,
    `  font-style: ${spec.style ?? "normal"};`,
    `  font-weight: ${spec.weight};`,
    `  font-display: swap;`,
    `  src: url("${uri}") format("truetype");`,
    "}",
  ].join("\n");
}

// The default-text rule — DELIBERATELY inheritance-only (genuinely LOW
// priority, not just "no !important"). Verified against a real local export
// (`npx expo export -p web` + serve, inspected live with Playwright):
//
// react-native-web gives every un-styled <Text> a directly-matching
// declaration — one shared reset class (`.css-146c3p1` on this RNW version,
// 0.20.x) that sets `font: 14px System` (→ the hardcoded -apple-system
// stack). An element with an explicit fontFamily (icons, "monospace", our
// Fraunces/Source-Serif heading styles) carries that SAME reset class PLUS a
// second atomic class overriding just font-family — RNW's own single
// stylesheet orders that override rule after the reset rule so it normally
// wins. Both the un-styled and the explicit-family case share the identical
// (0,1,0) specificity, so nothing here can select "only the un-styled ones" —
// verified by directly probing `.css-146c3p1 { font-family: monospace }` from
// a separately-appended (hence document-later, hence tie-winning) <style>:
// it flips EVERY Text, including the Fraunces "Mentible" wordmark, to
// monospace. That is the explicit-family clobber this file must not cause, so
// a same-or-higher-specificity default is not an option. An inheritance-only
// rule can't beat that same reset class either (a directly-matching
// declaration always beats an inherited one, regardless of specificity) — so
// this rule only reaches content that has no RNW-injected declaration of its
// own (nested Text-in-Text, which resolves `font: inherit`, and any raw DOM
// content outside RNW's Text, e.g. reader HTML that doesn't set its own
// font). Un-styled top-level RNW <Text> (nav labels, an un-styled "Sign in")
// stays on the system stack after just this CSS rule — that residual gap is
// closed below by installWebTextFontInterceptor, which resolves the family in
// JS before RNW ever emits CSS, sidestepping the cascade entirely.
const DEFAULT_TEXT_RULE = `html, body, #root {\n  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n}`;

// Paints the web page's actual ground (the html/body/#root stack sitting
// behind whatever RN-web renders) to the Studio (light/cream) background —
// otherwise it's the browser's default white, visible as a flash/edge outside
// our themed content. This is the app's default theme's background
// (constants/theme.ts studioLightColors.background); it's a static rule, not
// theme-reactive, since registerWebFonts runs once at module load, before any
// ThemeProvider — a persisted studio-dark choice repaints via the themed
// screens themselves, not this page-ground layer.
const ROOT_BACKGROUND_RULE = `html, body, #root {\n  background-color: ${studioLightColors.background};\n}`;

export function registerWebFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const css = [...FACES.map(faceRule), DEFAULT_TEXT_RULE, ROOT_BACKGROUND_RULE].join("\n\n");
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  installWebTextFontInterceptor();
}

// Same resolver + idempotent-sentinel idea as applyGlobalFont.ts's `patch()`
// (native), but NOT the same wrap point, and deliberately so — verified by
// instrumenting a real local export (`npx expo export -p web` + serve,
// inspected with Playwright): RNW's Text.render (node_modules/
// react-native-web/src/exports/Text/index.js) doesn't forward `props.style`
// down to the element it returns. It resolves `props.style` into atomic CSS
// classNames ITSELF, inside its own render body, via its own createElement,
// and returns a plain host element ('div'/'span'/'a') whose `props.style` is
// already gone (converted to `className`). So wrapping the OUTPUT the way
// applyGlobalFont does (inspect `element.props.style` after calling orig())
// sees `undefined` for every element and resolves every one of them to the
// same default body family — confirmed by a real render trace where a
// Fraunces heading and a plain paragraph both computed `Inter_400Regular`.
// Native's Text.render has no such transform (style flows to the native host
// component untouched), which is why applyGlobalFont's read-the-output
// pattern is correct THERE. On web the resolution has to happen on the INPUT:
// compute the family from the incoming props.style, append it to a NEW style
// array, and call the real Text.render with that augmented props object so
// RNW's own class-generation pipeline (and its insertion-order cascade win —
// see the DEFAULT_TEXT_RULE comment) processes our addition like any other
// style.
function patchWebText(Component: { render?: (...args: unknown[]) => unknown }) {
  const orig = Component.render;
  if (
    typeof orig !== "function" ||
    (orig as { __mentibleWebFontPatched?: boolean }).__mentibleWebFontPatched
  ) {
    return;
  }
  const patched = function (this: unknown, ...args: unknown[]) {
    const props = args[0] as { style?: unknown } | undefined;
    const family = resolveFamilyForStyle(props?.style, isDyslexic());
    if (!family) return orig.apply(this, args);
    const nextProps = {
      ...props,
      style: [props?.style, { fontFamily: family, fontWeight: "normal" as const }],
    };
    const nextArgs = [nextProps, ...args.slice(1)];
    return orig.apply(this, nextArgs);
  };
  (patched as { __mentibleWebFontPatched?: boolean }).__mentibleWebFontPatched = true;
  Component.render = patched;
}

// Install once (idempotent via the per-Component sentinel above). Exported so
// a jsdom test can call it directly without going through the whole
// registerWebFonts() DOM-injection path.
export function installWebTextFontInterceptor(): void {
  patchWebText(Text as unknown as { render?: (...args: unknown[]) => unknown });
  patchWebText(TextInput as unknown as { render?: (...args: unknown[]) => unknown });
}
