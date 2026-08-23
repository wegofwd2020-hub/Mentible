// Native bridge so the top/side nav's marketing links can scroll the single-page
// LandingHome to a section. On web, sections carry a `nativeID` and `goToAnchor`
// uses `scrollIntoView`; native has no DOM, so LandingHome registers a scroll
// callback here and each section reports its vertical offset via `onLayout`
// (see `anchor.ts`). Fixes the tablet bug where marketing links did nothing on
// native (goToAnchor used to `router.push("/")`, a no-op on Home). 2026-08-23.
type ScrollFn = (anchor: string) => void;

let scroller: ScrollFn | null = null;
const offsets: Record<string, number> = {};

// Each landing section records its y-offset within the scroll content (onLayout).
export function setSectionOffset(anchor: string, y: number): void {
  offsets[anchor] = y;
}
export function getSectionOffset(anchor: string): number {
  return offsets[anchor] ?? 0;
}

// LandingHome registers/clears the active scroller (its ScrollView) on mount/unmount.
export function setAnchorScroller(fn: ScrollFn | null): void {
  scroller = fn;
}

// goToAnchor (native) calls this; no-op if LandingHome isn't mounted.
export function scrollToAnchor(anchor: string): void {
  scroller?.(anchor);
}
