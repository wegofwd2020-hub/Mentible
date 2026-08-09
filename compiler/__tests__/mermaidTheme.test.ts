import { applyDiagramTheme } from "../src/mermaid";
import { DIAGRAM_ROLES, MERMAID_THEME_VARIABLES, STUDIO } from "../src/tokens";

// applyDiagramTheme injects the brand role classDefs into flowcharts (so the
// generator only has to tag nodes `:::role`), while leaving other diagram kinds
// and author-styled diagrams alone. The render path keys results by the ORIGINAL
// source, so this transform only ever affects what the renderer is fed.
describe("applyDiagramTheme", () => {
  it("injects every brand role classDef into a flowchart", () => {
    const out = applyDiagramTheme("flowchart LR\n  A[X]:::concept --> B[Y]:::process");
    for (const [role, s] of Object.entries(DIAGRAM_ROLES)) {
      expect(out).toContain(`classDef ${role} fill:${s.fill},color:${s.color},stroke:${s.stroke},stroke-width:2px;`);
    }
    // original content is preserved verbatim
    expect(out).toContain("A[X]:::concept --> B[Y]:::process");
  });

  it("treats the `graph` keyword as a flowchart too", () => {
    expect(applyDiagramTheme("graph TD; A-->B;")).toContain("classDef concept");
  });

  it("leaves non-flowchart diagrams untouched (classDef is invalid there)", () => {
    const seq = "sequenceDiagram; X->>Y: hi;";
    expect(applyDiagramTheme(seq)).toBe(seq);
  });

  it("is idempotent and respects author-defined role classDefs", () => {
    const authored = "flowchart LR\n A-->B\nclassDef concept fill:#000000;";
    expect(applyDiagramTheme(authored)).toBe(authored);
  });

  it("ignores leading whitespace when detecting the diagram type", () => {
    expect(applyDiagramTheme("\n  flowchart TD\n A-->B")).toContain("classDef concept");
  });
});

// Studio (P4) — DIAGRAM_ROLES and MERMAID_THEME_VARIABLES now reference the
// Studio export palette (navy/gold/panel), not the old BRAND indigo/lavender.
describe("Studio palette", () => {
  it("uses the Studio palette", () => {
    expect(STUDIO.navy).toBe("#0A0E1A");
    expect(STUDIO.gold).toBe("#8A6A22");
    expect(DIAGRAM_ROLES.concept.fill).toBe(STUDIO.navy); // concept → navy
    expect(MERMAID_THEME_VARIABLES.primaryBorderColor).toBe(STUDIO.gold);
    // every role has a fill+color+stroke
    for (const r of Object.values(DIAGRAM_ROLES)) {
      expect(r.fill).toBeTruthy();
      expect(r.color).toBeTruthy();
      expect(r.stroke).toBeTruthy();
    }
  });

  it("retints the base mermaid theme variables onto Studio panel/navy/gold", () => {
    expect(MERMAID_THEME_VARIABLES.primaryColor).toBe(STUDIO.panel);
    expect(MERMAID_THEME_VARIABLES.primaryTextColor).toBe(STUDIO.navy);
    expect(MERMAID_THEME_VARIABLES.tertiaryColor).toBe(STUDIO.ivory);
    expect(MERMAID_THEME_VARIABLES.tertiaryTextColor).toBe(STUDIO.navy);
  });
});
