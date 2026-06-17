// Bundled font families and the weight→family resolver used by the global text
// interceptor (src/lib/applyGlobalFont).
//
// Why a resolver instead of fontWeight? React Native does NOT synthesize weight
// from a *static* bundled font — each weight is its own family name (e.g.
// "Inter_700Bold"). So instead of touching the ~120 `fontWeight` sites across the
// app, the interceptor reads the requested weight and picks the matching family.
//
// Three roles:
//   • body    → Inter            (clean, light sans; fixes the heavy Roboto look)
//   • heading → Source Serif 4    (serif; restores sans/serif hierarchy)
//   • dyslexic→ OpenDyslexic      (accessibility toggle; overrides everything)
//
// Inter + Source Serif 4 come from @expo-google-fonts/*; OpenDyslexic ttf is
// vendored in assets/fonts (see assets/fonts/OpenDyslexic-*.ttf).
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

// The map passed to useFonts(). Keys are the family names referenced everywhere else.
export const FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
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

// Source Serif 4 ships no medium here; medium maps to regular.
const SERIF = {
  regular: "SourceSerif4_400Regular",
  medium: "SourceSerif4_400Regular",
  semibold: "SourceSerif4_600SemiBold",
  bold: "SourceSerif4_700Bold",
} as const;

// OpenDyslexic ships only Regular + Bold; semibold/medium round to the nearest.
const DYSLEXIC = {
  regular: "OpenDyslexic_400Regular",
  medium: "OpenDyslexic_400Regular",
  semibold: "OpenDyslexic_700Bold",
  bold: "OpenDyslexic_700Bold",
} as const;

// Resolve the concrete family name for a (role, weight), honouring dyslexic mode
// which overrides both roles so ALL text uses OpenDyslexic.
export function resolveFamily(role: FontRole, weight: Weight | undefined, dyslexic: boolean): string {
  const b = bucket(weight);
  if (dyslexic) return DYSLEXIC[b];
  return role === "heading" ? SERIF[b] : INTER[b];
}
