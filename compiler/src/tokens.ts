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
  green: "#16a34a", // secondary brand green
  greenBright: "#4ade80", // accent / glow green
  greenDark: "#15803d", // green border
  teal: "#0e7490", // decision/accent teal
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

// Diagram node-role palette. The generator tags flowchart nodes with these role
// classes (`:::concept`, `:::process`, …) and the compiler injects the matching
// Mermaid `classDef`s (see mermaid.ts) — turning plain flowcharts into on-brand,
// high-contrast "designed infographics" while staying vector + accessible.
export const DIAGRAM_ROLES: Record<string, RoleStyle> = {
  concept: { fill: BRAND.indigo, color: "#ffffff", stroke: BRAND.indigoDark },
  process: { fill: BRAND.lavenderNode, color: BRAND.indigoDark, stroke: BRAND.indigo },
  decision: { fill: BRAND.teal, color: "#ffffff", stroke: BRAND.tealDark },
  success: { fill: BRAND.green, color: "#ffffff", stroke: BRAND.greenDark },
  warn: { fill: BRAND.amber, color: BRAND.amberText, stroke: BRAND.amberStroke },
};

// Mermaid `base`-theme variables — the default look applied to EVERY diagram,
// including legacy ones whose nodes carry no role class (they simply lift from
// the old gray "neutral" theme to on-brand lavender/indigo).
export const MERMAID_THEME_VARIABLES = {
  fontFamily: "'Helvetica Neue', 'Liberation Sans', Arial, sans-serif",
  fontSize: "17px",
  primaryColor: BRAND.lavenderNode,
  primaryTextColor: BRAND.indigoDark,
  primaryBorderColor: BRAND.indigo,
  lineColor: BRAND.edge,
  secondaryColor: "#dcfce7",
  tertiaryColor: "#e0f2fe",
  tertiaryTextColor: BRAND.indigoDark,
} as const;
