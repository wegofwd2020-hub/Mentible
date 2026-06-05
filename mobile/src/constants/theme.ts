export const colors = {
  background: "#0f172a",
  surface: "#1e293b",
  surfaceHigh: "#334155",
  border: "#334155",
  borderLight: "#475569",

  text: "#f1f5f9",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",

  primary: "#6366f1",
  primaryText: "#ffffff",

  // Mentible warm orange — the active/selected accent (from the brand mark).
  brand: "#ef8a16",
  brandText: "#ffffff",

  // Nav buttons. OFF: white face, black glyphs, raised bevel (white highlight /
  // grey shadow). ON: yellow face, black glyphs, inset bevel (dark / light
  // yellow edges) so the active tile looks pressed in.
  tileOffFace: "#ffffff",
  tileOffGlyph: "#111827",
  tileOffShadow: "#94a3b8",
  tileOnFace: "#facc15",
  tileOnGlyph: "#111827",
  tileOnHi: "#fde68a",
  tileOnLo: "#a16207",
  // Secondary line (chip descriptions) on a light tile — dark slate, legible on
  // both the white and yellow faces.
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
  fontHeading: undefined as string | undefined,
  fontBody: undefined as string | undefined,
  fontMono: undefined as string | undefined,

  sizeXs: 12,
  sizeSm: 14,
  sizeMd: 16,
  sizeLg: 18,
  sizeXl: 22,
  sizeXxl: 28,

  lineHeightNormal: 1.5,
  lineHeightRelaxed: 1.75,
} as const;
