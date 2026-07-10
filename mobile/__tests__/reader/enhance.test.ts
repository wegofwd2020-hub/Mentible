/**
 * @jest-environment jsdom
 */
import { enhanceReaderNode, renderDiagrams, renderMath } from "@/reader/enhance";

// Note: babel-plugin-jest-hoist only permits jest.mock() factories to close over
// out-of-scope variables whose names are prefixed with "mock" (case-insensitive).
// The brief's variable names (mermaidRun, mermaidInitialize, renderMathInElement)
// trip that guard in this repo's babel/jest setup — renamed with a mock* prefix,
// otherwise identical to the brief.
const mockMermaidRun = jest.fn().mockResolvedValue(undefined);
const mockMermaidInitialize = jest.fn();
jest.mock("mermaid", () => ({
  __esModule: true,
  default: {
    initialize: (...a: unknown[]) => mockMermaidInitialize(...a),
    run: (...a: unknown[]) => mockMermaidRun(...a),
  },
}));

const mockRenderMathInElement = jest.fn();
jest.mock("katex/contrib/auto-render", () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockRenderMathInElement(...a),
}));

function nodeWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = "";
});

describe("renderMath", () => {
  it("runs KaTeX over the node with both delimiter forms", () => {
    const node = nodeWith("<p>$$x^2$$</p>");
    renderMath(node);
    expect(mockRenderMathInElement).toHaveBeenCalledWith(
      node,
      expect.objectContaining({
        throwOnError: false,
        ignoredClasses: expect.arrayContaining(["mermaid", "anim-svg"]),
        delimiters: expect.arrayContaining([
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ]),
      }),
    );
  });
});

describe("renderDiagrams — lazy (spec D2)", () => {
  it("does NOT load mermaid when the node has no diagram", async () => {
    expect(await renderDiagrams(nodeWith("<p>Just prose.</p>"))).toBe(false);
    expect(mockMermaidInitialize).not.toHaveBeenCalled();
    expect(mockMermaidRun).not.toHaveBeenCalled();
  });

  it("loads and runs mermaid when the node has a diagram", async () => {
    const node = nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>');
    expect(await renderDiagrams(node)).toBe(true);
    expect(mockMermaidRun).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [node.querySelector(".mermaid")] }),
    );
  });

  it("configures mermaid with securityLevel strict and no autostart (spec D4)", async () => {
    await renderDiagrams(nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>'));
    expect(mockMermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  it("skips the run when cancelled before mermaid resolves (unmount race)", async () => {
    const node = nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>');
    expect(await renderDiagrams(node, () => true)).toBe(false);
    expect(mockMermaidRun).not.toHaveBeenCalled();
  });
});

describe("enhanceReaderNode", () => {
  it("runs the math pass immediately and returns a cleanup function", () => {
    const cleanup = enhanceReaderNode(nodeWith("<p>$x$</p>"));
    expect(mockRenderMathInElement).toHaveBeenCalled();
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("cleanup prevents a late mermaid run", async () => {
    const cleanup = enhanceReaderNode(nodeWith('<div class="mermaid">graph TD;A--&gt;B</div>'));
    cleanup(); // unmount before the ~3MB chunk resolves
    // Flush the microtask queue AND the macrotask queue — two `await Promise.resolve()`
    // is not enough to settle the dynamic import's promise chain.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockMermaidRun).not.toHaveBeenCalled();
  });
});
