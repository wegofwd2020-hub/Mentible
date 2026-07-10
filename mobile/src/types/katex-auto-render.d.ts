declare module "katex/contrib/auto-render" {
  interface AutoRenderOptions {
    delimiters?: { left: string; right: string; display: boolean }[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
  }
  export default function renderMathInElement(elem: HTMLElement, options?: AutoRenderOptions): void;
}
