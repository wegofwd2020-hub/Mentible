// Native no-op. On native the bundled fonts are already real per-weight
// families (see src/constants/fonts) and the global text interceptor
// (src/lib/applyGlobalFont) assigns them — there is no CSS to inject. Metro
// picks webFonts.web.ts on web and this file everywhere else.
export function registerWebFonts(): void {}
