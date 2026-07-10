// The native web reader's post-mount DOM passes. Deliberately NOT inside the
// component: React Native Testing Library renders through react-test-renderer, so a
// host `ref.current` is null and nothing lands in `document`. Keeping these as plain
// functions over an HTMLElement means they can be tested against a real jsdom node
// instead of asserted vacuously.
//
// Both passes run AFTER sanitization, on markup the sanitizer already cleared. The
// HTML they add (KaTeX spans, Mermaid <svg>) is library-produced, not model-produced.
//
// Web-only.

import renderMathInElement from "katex/contrib/auto-render";

/** Render `$…$` / `$$…$$` in place. Mermaid and raw-SVG figures are skipped. */
export function renderMath(node: HTMLElement): void {
  renderMathInElement(node, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    ignoredClasses: ["mermaid", "anim-svg"],
    throwOnError: false,
  });
}

/**
 * Render any `.mermaid` blocks. Mermaid is ~3MB, so it is dynamically imported ONLY
 * when the topic actually contains a diagram (spec D2) — prose-only topics never pay
 * for it. `securityLevel: "strict"` disables click handlers and HTML labels; the
 * diagram source sat in the DOM as escaped text until this moment (spec D4).
 *
 * Resolves true iff Mermaid was loaded and run.
 */
export async function renderDiagrams(
  node: HTMLElement,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  const nodes = Array.from(node.querySelectorAll<HTMLElement>(".mermaid"));
  if (nodes.length === 0) return false;

  const mermaid = (await import("mermaid")).default;
  // The component may have unmounted while the ~3MB chunk was in flight.
  if (isCancelled()) return false;

  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  await mermaid.run({ nodes });
  return true;
}

/** Run every post-pass on a mounted reader node. Returns an unmount cleanup. */
export function enhanceReaderNode(node: HTMLElement): () => void {
  let cancelled = false;
  renderMath(node);
  void renderDiagrams(node, () => cancelled);
  return () => {
    cancelled = true;
  };
}
