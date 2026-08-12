// Bundled font families and the weight→family resolver used by the global text
// interceptor (src/lib/applyGlobalFont).
//
// Why a resolver instead of fontWeight? React Native does NOT synthesize weight
// from a *static* bundled font — each weight is its own family name (e.g.
// "Inter_700Bold"). So instead of touching the ~120 `fontWeight` sites across the
// app, the interceptor reads the requested weight and picks the matching family.
//
// Three roles:
//   • body    → Inter             (clean, light sans; fixes the heavy Roboto look)
//   • heading → Fraunces          (app-chrome headings → Fraunces pass; was
//                                  Playfair Display under Studio reskin P0 before
//                                  that, and Source Serif 4 before that — all
//                                  still bundled/defined for any literal
//                                  references until they're migrated. The
//                                  reader/book-read surface stays on Playfair
//                                  directly, bypassing this resolver.)
//   • dyslexic→ OpenDyslexic       (accessibility toggle; overrides everything)
//
// Inter, Source Serif 4, Fraunces + Playfair Display come from
// @expo-google-fonts/*; OpenDyslexic ttf is vendored in assets/fonts (see
// assets/fonts/OpenDyslexic-*.ttf).
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from "@expo-google-fonts/source-serif-4";
import {
  Fraunces_400Regular,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold_Italic,
} from "@expo-google-fonts/fraunces";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
} from "@expo-google-fonts/playfair-display";

// The map passed to useFonts(). Keys are the family names referenced everywhere else.
export const FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
  // Fraunces: the SME/Navy-Trust heading brand (ADR-038 O2). Only the SME
  // surfaces opt in; the rest of the app keeps Source Serif 4. The italics power
  // the editorial "accent word" (ADR-038 O2 polish).
  Fraunces_400Regular,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold_Italic,
  // Playfair Display: the app-wide heading face (Studio reskin P0).
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
  OpenDyslexic_400Regular: require("../../assets/fonts/OpenDyslexic-Regular.ttf"),
  OpenDyslexic_700Bold: require("../../assets/fonts/OpenDyslexic-Bold.ttf"),
} as const;

export type FontRole = "body" | "heading";

// RN fontWeight is broadly typed (string | number); we normalise it in bucket().
type Weight = string | number;

// Normalises a RN fontWeight (string | number | undefined) to a coarse bucket.
function bucket(weight: Weight | undefined): "regular" | "medium" | "semibold" | "bold" {
  if (weight === "bold") return "bold";
  const n = typeof weight === "number" ? weight : parseInt(String(weight ?? "400"), 10);
  if (Number.isNaN(n)) return "regular";
  if (n >= 700) return "bold";
  if (n >= 600) return "semibold";
  if (n >= 500) return "medium";
  return "regular";
}

const INTER = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// Source Serif 4 ships no medium here; medium maps to regular. No longer
// referenced by resolveFamily (heading now always resolves to Playfair —
// Studio reskin P0); exported (not deleted) for any literal references until
// they migrate.
export const SERIF = {
  regular: "SourceSerif4_400Regular",
  medium: "SourceSerif4_400Regular",
  semibold: "SourceSerif4_600SemiBold",
  bold: "SourceSerif4_700Bold",
} as const;

// Fraunces — the SME/Navy-Trust heading brand (ADR-038 O2). Same weight buckets
// as SERIF (no bundled medium → regular). SME heading styles reference these
// concrete names directly so they resolve on web too (where the native text
// interceptor doesn't run); on native the interceptor still routes Fraunces
// through resolveFamily so dyslexic mode keeps overriding it.
export const FRAUNCES = {
  regular: "Fraunces_400Regular",
  medium: "Fraunces_400Regular",
  semibold: "Fraunces_600SemiBold",
  bold: "Fraunces_700Bold",
} as const;

// Italic Fraunces — the editorial "accent word" (ADR-038 O2). The slant is baked
// into the family name (no fontStyle:"italic", which would synth double-italic on
// web). The interceptor preserves the exact family on native and still yields to
// dyslexic mode.
export const FRAUNCES_ITALIC = {
  regular: "Fraunces_400Regular_Italic",
  semibold: "Fraunces_600SemiBold_Italic",
} as const;

// Playfair Display — the app-wide heading face (Studio reskin P0). Ships no
// bundled 700 weight here; bold rounds down to 600SemiBold like the other
// heading maps round unavailable weights to their nearest loaded face.
export const PLAYFAIR = {
  regular: "PlayfairDisplay_400Regular",
  medium: "PlayfairDisplay_500Medium",
  semibold: "PlayfairDisplay_600SemiBold",
  bold: "PlayfairDisplay_600SemiBold",
} as const;

// Heading brand: historical serif/fraunces selector. Retired as of the Studio
// reskin P0 — resolveFamily's heading branch now always returns Playfair
// regardless of `brand` (kept below only for call-site signature stability).
// SERIF/FRAUNCES stay defined for literal references until they migrate.
export type HeadingBrand = "serif" | "fraunces";

// OpenDyslexic ships only Regular + Bold; semibold/medium round to the nearest.
const DYSLEXIC = {
  regular: "OpenDyslexic_400Regular",
  medium: "OpenDyslexic_400Regular",
  semibold: "OpenDyslexic_700Bold",
  bold: "OpenDyslexic_700Bold",
} as const;

// Resolve the concrete family name for a (role, weight), honouring dyslexic mode
// which overrides both roles so ALL text uses OpenDyslexic. Heading always
// resolves to Fraunces (app-chrome headings → Fraunces pass; Studio reskin P0
// picked Playfair Display before this) regardless of `brand` — the param is
// retained only for call-site signature stability (see HeadingBrand).
export function resolveFamily(
  role: FontRole,
  weight: Weight | undefined,
  dyslexic: boolean,
  brand: HeadingBrand = "serif",
): string {
  const b = bucket(weight);
  if (dyslexic) return DYSLEXIC[b];
  if (role === "heading") return FRAUNCES[b];
  return INTER[b];
}
