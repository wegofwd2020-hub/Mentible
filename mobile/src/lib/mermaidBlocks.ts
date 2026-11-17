// Pure helpers for editing the ```mermaid diagrams inside a topic's section bodies.
//
// A diagram is addressed by (sectionIndex, blockIndex): the blockIndex-th ```mermaid
// fence inside that section's body. Only that one fence is rewritten; everything
// else in every section is returned untouched.

export type SectionLike = { heading: string; body: string };

export type DiagramRef = {
  sectionIndex: number;
  blockIndex: number;
  source: string;
};

// A mermaid fence: opening line, the source, closing fence on its own line.
const MERMAID_FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

/** Every mermaid diagram in the sections, in document order. */
export function listDiagrams(sections: SectionLike[]): DiagramRef[] {
  const out: DiagramRef[] = [];
  sections.forEach((s, sectionIndex) => {
    let blockIndex = 0;
    for (const m of (s.body ?? "").matchAll(MERMAID_FENCE)) {
      out.push({ sectionIndex, blockIndex, source: m[1] ?? "" });
      blockIndex += 1;
    }
  });
  return out;
}

/**
 * Return a copy of `sections` with the addressed diagram's source replaced.
 * Unknown addresses return the sections unchanged (a no-op, never a throw).
 */
export function replaceDiagramSource<T extends SectionLike>(
  sections: T[],
  sectionIndex: number,
  blockIndex: number,
  source: string,
): T[] {
  return sections.map((s, i) => {
    if (i !== sectionIndex) return s;
    let seen = 0;
    const body = (s.body ?? "").replace(MERMAID_FENCE, (whole) => {
      const current = seen;
      seen += 1;
      if (current !== blockIndex) return whole;
      return "```mermaid\n" + source.trim() + "\n```";
    });
    return { ...s, body };
  });
}
