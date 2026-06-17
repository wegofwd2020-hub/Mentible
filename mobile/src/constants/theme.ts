// Mentible UI theme tokens.
//
// (Platform is used only by the typography block below, for web-vs-native fonts.)
import { Platform } from "react-native";

// Colours derive from the brand mark ("growing mind"): indigo = mind,
// green = growth, red-orange = the "M" / primary action, teal = the book.
// See docs/adr/ADR-006 (brand) and docs/adr/ADR-007 (book template palette);
// the app palette below is intentionally kept in step with the book output so
// authoring and reading feel continuous.
//
// `colors` is the default ("Study", dark). Two further palettes — `manuscriptColors`
// (light, print-bridge) and `readingColors` (sepia, reader-only) — are exported for
// a future theme switcher; nothing consumes them yet, so this change is additive and
// the default look only shifts from the old slate/indigo/yellow scheme onto the mark.

export const colors = {
  background: "#14152a",
  surface: "#1f2140",
  surfaceHigh: "#2c2f52",
  border: "#2c2f52",
  borderLight: "#3b3f6b",

  text: "#eef1f8",
  textSecondary: "#9aa3c0",
  textMuted: "#6b7299",

  // Brand indigo, lightened for legibility on the dark surface.
  primary: "#6d5ae6",
  primaryText: "#ffffff",

  // The red-orange "M" — the active/selected accent and primary call to action.
  brand: "#f2731f",
  brandText: "#2a0f04",

  // Growth green — generation/progress and positive "it grew" moments (pairs
  // with the sprout→leaf icon motif in the UI).
  growth: "#6cc79a",
  growthText: "#06321f",

  // Nav buttons. OFF: white face, indigo-ink glyphs, raised bevel (white
  // highlight / grey shadow). ON: red-orange brand face, dark glyphs, inset
  // bevel — so the active tile looks pressed in. (Was a saturated yellow face;
  // retired because it read close to the "For Dummies" anti-pattern called out
  // in the house-style notes — ADR-006 voice / docs/comparisons.)
  tileOffFace: "#ffffff",
  tileOffGlyph: "#1e1b4b",
  tileOffShadow: "#9aa3c0",
  tileOnFace: "#f2731f",
  tileOnGlyph: "#2a0f04",
  tileOnHi: "#f8a35e",
  tileOnLo: "#b5400f",
  // Secondary line (chip descriptions) on a light tile — dark slate, legible on
  // both the white and the brand-orange faces.
  tileSubGlyph: "#475569",

  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",

  white: "#ffffff",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const;

export const typography = {
  // Fonts. The serif headings tie the app to the book output (Source Serif 4);
  // the sans keeps UI chrome legible; mono is for the BYOK key field + code.
  //
  // Web (react-native-web) resolves a CSS font *stack* and uses the values below.
  // On NATIVE the real families are now bundled (Inter + Source Serif 4 via
  // @expo-google-fonts, OpenDyslexic vendored) and applied by the global text
  // interceptor (src/lib/applyGlobalFont), which maps each weight to its concrete
  // family. The native values here are only read by the few sites that set a
  // fontFamily directly; the interceptor recognises "serif"/"Georgia" as a heading
  // and "monospace" as code, so these still resolve correctly.
  fontHeading: Platform.select({
    web: "'Source Serif 4', 'Iowan Old Style', Georgia, serif",
    ios: "Georgia", // built-in serif
    default: "serif", // Android built-in serif alias
  }),
  fontBody: Platform.select({
    web: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    default: undefined, // system sans on native until Inter is bundled
  }),
  fontMono: Platform.select({
    web: "'JetBrains Mono', 'SF Mono', 'IBM Plex Mono', Menlo, monospace",
    ios: "Menlo", // built-in monospace
    default: "monospace", // Android built-in monospace
  }),

  sizeXs: 12,
  sizeSm: 14,
  sizeMd: 16,
  sizeLg: 18,
  sizeXl: 22,
  sizeXxl: 28,

  lineHeightNormal: 1.5,
  lineHeightRelaxed: 1.75,
} as const;

// ── Additional palettes (for a future theme switcher; see the v1.1 accounts
// work). Same keys as `colors` so a ThemeProvider can swap one for another. ──

export type Palette = Record<keyof typeof colors, string>;

// "Manuscript" — light, warm-paper theme that bridges the app to the printed
// book (indigo ink, green growth, red-orange action on parchment).
export const manuscriptColors: Palette = {
  background: "#faf7f1",
  surface: "#ffffff",
  surfaceHigh: "#f3eee4",
  border: "#ece8fb",
  borderLight: "#e2ddf2",

  text: "#1e1b4b",
  textSecondary: "#5b5a78",
  textMuted: "#8a89a3",

  primary: "#312a8c",
  primaryText: "#ffffff",

  brand: "#d2400c",
  brandText: "#ffffff",

  growth: "#2a9258",
  growthText: "#ffffff",

  tileOffFace: "#ffffff",
  tileOffGlyph: "#1e1b4b",
  tileOffShadow: "#cfcadf",
  tileOnFace: "#d2400c",
  tileOnGlyph: "#ffffff",
  tileOnHi: "#e9683a",
  tileOnLo: "#9e2f08",
  tileSubGlyph: "#5b5a78",

  success: "#1f7544",
  error: "#b3261e",
  warning: "#b06a00",

  white: "#ffffff",
};

// "Reading" — sepia, low-glare reader theme for the book reader (the authored
// book is the hero; chrome recedes, like an e-reader page mode).
export const readingColors: Palette = {
  background: "#f3e9d2",
  surface: "#f7efdc",
  surfaceHigh: "#ece0c4",
  border: "#e0d3b5",
  borderLight: "#d6c7a4",

  text: "#3a2f1b",
  textSecondary: "#6d5d40",
  textMuted: "#8a795b",

  primary: "#312a8c",
  primaryText: "#ffffff",

  brand: "#a23708",
  brandText: "#ffffff",

  growth: "#1f7544",
  growthText: "#ffffff",

  tileOffFace: "#f7efdc",
  tileOffGlyph: "#3a2f1b",
  tileOffShadow: "#cdbd99",
  tileOnFace: "#a23708",
  tileOnGlyph: "#ffffff",
  tileOnHi: "#c2592a",
  tileOnLo: "#7a2906",
  tileSubGlyph: "#6d5d40",

  success: "#1f7544",
  error: "#9e2b22",
  warning: "#9a6300",

  white: "#ffffff",
};

export const themes = {
  study: colors as unknown as Palette,
  manuscript: manuscriptColors,
  reading: readingColors,
} as const;

export type ThemeName = keyof typeof themes;
