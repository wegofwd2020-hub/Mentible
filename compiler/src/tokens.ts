// Central design tokens — the single source of truth for the Mentible artifact
// palette. Previously the brand colours were duplicated inline across cover.ts,
// css.ts and (implicitly) the diagram theme; this module collects them so the
// cover, the stylesheet, and the Mermaid diagram theming all draw from one place.
//
// Keep this dependency-free (plain constants) — it is imported by both the
// render path and the dependency-light fallbacks.

// Core brand palette (the indigo/green "growing mind" identity).
export const BRAND = {
  indigo: "#312a8c", // primary brand indigo
  indigoDark: "#1e1b4b", // deep indigo (title text, dark page bg)
  indigoLuminous: "#4c1d95", // gradient top
  indigoSoft: "#cdbcff", // light indigo (on dark fields)
  lavender: "#f5f3ff", // pale lavender panel
  lavenderNode: "#ede9fe", // diagram node fill / soft surfaces
  lavenderBorder: "#ece8fb", // hairline lavender border
  green: "#2a9258", // secondary brand green (desaturated ~12% for a calmer, editorial accent)
  greenBright: "#6cc79a", // accent / glow green (muted)
  greenDark: "#1f7544", // green border
  teal: "#1b7287", // decision/accent teal (desaturated)
  tealDark: "#0c4a6e", // teal border
  amber: "#fde68a", // caution fill
  amberText: "#7c2d12", // caution text
  amberStroke: "#d97706", // caution border
  edge: "#7c3aed", // diagram connector/edge colour
} as const;

export interface RoleStyle {
  fill: string;
  color: string;
  stroke: string;
}

// Studio identity (P4) — the export palette. Light artifact: navy only on the
// cover; gold accents on the light page. AA-checked for grayscale legibility.
export const STUDIO = {
  navy: "#0A0E1A", navySurface: "#131E36", navyLuminous: "#1B2842", navyBorder: "#323846",
  navySoft: "#93A6C6",         // soft light-blue on navy (decorative lines on cover)
  gold: "#8A6A22",             // dark gold — accents on the LIGHT ground (AA on ivory/white)
  goldBright: "#F0DCAC",       // light gold — accents on the NAVY cover
  goldSoft: "#C9B37E",
  ivory: "#faf8f3", ink: "#1a1a1a", panel: "#f3efe6",   // warm light panel (cover lower)
  green: "#356E56", greenBright: "#8FCBAD",             // success / accent green (tuned, AA)
  amber: "#B5741A", amberText: "#5a3e12", amberFill: "#F1E2BE", // caution (distinct from gold)
} as const;

// Diagram node-role palette. The generator tags flowchart nodes with these role
// classes (`:::concept`, `:::process`, …) and the compiler injects the matching
// Mermaid `classDef`s (see mermaid.ts) — turning plain flowcharts into on-brand,
// high-contrast "designed infographics" while staying vector + accessible.
//
// Retinted to the Studio palette (P4). Every fill/color pair below is AA-checked
// (contrast ratios computed against WCAG 2.1's relative-luminance formula):
//   concept  navy/white     ~19.3:1
//   process  panel/navy     ~16.8:1
//   decision goldSoft/navy   ~9.4:1
//   success  green/white     ~6.0:1
//   warn     amberFill/amberText ~7.7:1
// All comfortably clear AA (>=4.5:1). Fills are also grayscale-distinct — their
// relative luminances, sorted dark→light, are navy(~0.005) < green(~0.13) <
// goldSoft(~0.46) < amberFill(~0.77) < panel(~0.87) on a 0..1 scale — no two
// roles collapse to the same gray when the export is printed monochrome. The
// closest pair (amberFill vs panel) still differs by ~25/255 in 8-bit gray and
// each role additionally carries a distinct stroke, so no nudge was needed.
export const DIAGRAM_ROLES: Record<string, RoleStyle> = {
  concept: { fill: STUDIO.navy, color: "#ffffff", stroke: STUDIO.navyBorder },
  process: { fill: STUDIO.panel, color: STUDIO.navy, stroke: STUDIO.gold },
  decision: { fill: STUDIO.goldSoft, color: STUDIO.navy, stroke: STUDIO.gold },
  success: { fill: STUDIO.green, color: "#ffffff", stroke: "#274d3d" },
  warn: { fill: STUDIO.amberFill, color: STUDIO.amberText, stroke: STUDIO.amber },
};

// Mermaid `base`-theme variables — the default look applied to EVERY diagram,
// including legacy ones whose nodes carry no role class (they simply lift from
// the old gray "neutral" theme onto the Studio panel/navy/gold identity).
export const MERMAID_THEME_VARIABLES = {
  fontFamily: "'Helvetica Neue', 'Liberation Sans', Arial, sans-serif",
  fontSize: "17px",
  primaryColor: STUDIO.panel,
  primaryTextColor: STUDIO.navy,
  primaryBorderColor: STUDIO.gold,
  lineColor: STUDIO.gold,
  secondaryColor: "#e4efe8",
  tertiaryColor: STUDIO.ivory,
  tertiaryTextColor: STUDIO.navy,
} as const;
