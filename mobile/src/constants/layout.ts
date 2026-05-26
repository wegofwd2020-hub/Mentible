// Responsive breakpoints + content-width caps for the web/desktop layout.
// Mobile (phone) remains the default below `tablet`.
export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const;

// Reading/editing surfaces (forms, the topic-tree editor) read best capped to a
// comfortable column rather than stretched across a wide monitor.
export const MAX_CONTENT_WIDTH = 920;

// Wider surfaces that genuinely use horizontal space (grids, two-column runner).
export const MAX_WIDE_WIDTH = 1200;
