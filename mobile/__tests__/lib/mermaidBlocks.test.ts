import { listDiagrams, replaceDiagramSource } from "@/lib/mermaidBlocks";

const FLOW = "flowchart TD\n  A --> B";
const MIND = "mindmap\n  root((Indra))\n    Agni";

describe("listDiagrams", () => {
  it("returns every mermaid fence in document order with section and block indices", () => {
    const sections = [
      { heading: "One", body: `Intro\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nmore` },
      { heading: "Two", body: "prose only" },
      { heading: "Three", body: `\`\`\`mermaid\n${MIND}\n\`\`\`\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`` },
    ];
    expect(listDiagrams(sections)).toEqual([
      { sectionIndex: 0, blockIndex: 0, source: FLOW },
      { sectionIndex: 2, blockIndex: 0, source: MIND },
      { sectionIndex: 2, blockIndex: 1, source: FLOW },
    ]);
  });

  it("ignores non-mermaid fences such as svg or plain code", () => {
    const sections = [{ heading: "X", body: "```svg\n<svg/>\n```\n```\nplain\n```" }];
    expect(listDiagrams(sections)).toEqual([]);
  });

  it("tolerates a missing body", () => {
    expect(listDiagrams([{ heading: "X", body: undefined as unknown as string }])).toEqual([]);
  });
});

describe("replaceDiagramSource", () => {
  it("rewrites only the addressed diagram and leaves other blocks and sections intact", () => {
    const sections = [
      { heading: "One", body: `\`\`\`mermaid\n${FLOW}\n\`\`\`` },
      { heading: "Two", body: `\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n\`\`\`mermaid\n${MIND}\n\`\`\`` },
    ];
    const out = replaceDiagramSource(sections, 1, 1, "mindmap\n  root((New))");
    expect(out[0]).toEqual(sections[0]);
    expect(out[1].body).toBe(`\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n\`\`\`mermaid\nmindmap\n  root((New))\n\`\`\``);
    expect(out[1].heading).toBe("Two");
  });

  it("trims surrounding whitespace from the new source", () => {
    const sections = [{ heading: "One", body: `\`\`\`mermaid\n${FLOW}\n\`\`\`` }];
    const out = replaceDiagramSource(sections, 0, 0, "\n  flowchart LR\n  A --> B\n");
    expect(out[0].body).toBe("```mermaid\nflowchart LR\n  A --> B\n```");
  });

  it("is a no-op for an unknown address and never throws", () => {
    const sections = [{ heading: "One", body: `\`\`\`mermaid\n${FLOW}\n\`\`\`` }];
    expect(replaceDiagramSource(sections, 5, 0, "x")).toEqual(sections);
    expect(replaceDiagramSource(sections, 0, 9, "x")).toEqual(sections);
  });

  it("does not mutate the input sections", () => {
    const sections = [{ heading: "One", body: `\`\`\`mermaid\n${FLOW}\n\`\`\`` }];
    const snapshot = JSON.stringify(sections);
    replaceDiagramSource(sections, 0, 0, "flowchart LR\n  X --> Y");
    expect(JSON.stringify(sections)).toBe(snapshot);
  });

  it("round-trips: the listed source comes back unchanged after a no-op replace", () => {
    const sections = [{ heading: "One", body: `\`\`\`mermaid\n${MIND}\n\`\`\`` }];
    const [ref] = listDiagrams(sections);
    const out = replaceDiagramSource(sections, ref.sectionIndex, ref.blockIndex, ref.source);
    expect(listDiagrams(out)).toEqual([ref]);
  });
});
