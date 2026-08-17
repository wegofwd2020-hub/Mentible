import { STYLESHEET, KDP_STYLESHEET } from "../src/css";

describe("STYLESHEET (Studio P4 text export)", () => {
  it("uses Playfair headings + gold accent on a kept ivory ground", () => {
    // Playfair headings, single-weight, no faux-bold.
    expect(STYLESHEET).toContain("Playfair Display");
    expect(STYLESHEET).toContain("font-synthesis: none");
    expect(STYLESHEET).not.toMatch(/h1[^}]*font-weight:\s*700/);
    expect(STYLESHEET).not.toMatch(/h2[^}]*font-weight:\s*700/);
    expect(STYLESHEET).not.toMatch(/h3[^}]*font-weight:\s*600/);
    expect(STYLESHEET).not.toMatch(/h4[^}]*font-weight:\s*600/);

    // Gold accent (Studio) present; old indigo blue link colour gone.
    expect(STYLESHEET).toContain("#8A6A22");
    expect(STYLESHEET).not.toContain("#1565c0");

    // Ivory print ground + serif body kept.
    expect(STYLESHEET).toContain("#faf8f3");
    expect(STYLESHEET).toContain("Liberation Serif");
  });

  it("keeps the shared h1..h6 rule single-weight with font-synthesis disabled", () => {
    const headingRule = STYLESHEET.match(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*\}/);
    expect(headingRule).not.toBeNull();
    expect(headingRule![0]).toMatch(/font-family:\s*'Playfair Display'/);
    expect(headingRule![0]).toContain("font-weight: 500");
    expect(headingRule![0]).toContain("font-synthesis: none");
  });

  it("retints the .diagram panel to Studio warm/gold, not the old lavender brand", () => {
    const diagramRule = STYLESHEET.match(/\.diagram\s*\{[^}]*\}/);
    expect(diagramRule).not.toBeNull();
    expect(diagramRule![0]).toContain("#f3efe6"); // STUDIO.panel
    expect(diagramRule![0]).not.toContain("#f5f3ff"); // BRAND.lavender (old)
    expect(diagramRule![0]).not.toContain("#ece8fb"); // BRAND.lavenderBorder (old)
  });
});

describe("KDP_STYLESHEET (D2, docs/specs/kdp-clean-export-profile.md)", () => {
  it("drops the embedded @font-face rules", () => {
    expect(STYLESHEET).toContain("@font-face"); // sanity: the default DOES embed fonts
    expect(KDP_STYLESHEET).not.toContain("@font-face");
  });

  it("drops font-family and line-height on the bare body selector", () => {
    const bodyRule = KDP_STYLESHEET.match(/(?<!\.diagram|\.floatlist)\bbody\s*\{[^}]*\}/);
    expect(bodyRule).not.toBeNull();
    expect(bodyRule![0]).not.toMatch(/font-family/);
    expect(bodyRule![0]).not.toMatch(/line-height/);
    // still keeps the non-typography body rules
    expect(bodyRule![0]).toContain("background: #faf8f3");
    expect(bodyRule![0]).toContain("counter-reset: figure table");
  });

  it("keeps heading, table, figure and quiz styles", () => {
    expect(KDP_STYLESHEET).toContain("Playfair Display"); // h1..h6 still declare it (falls back if not embedded)
    expect(KDP_STYLESHEET).toMatch(/table\s*\{/);
    expect(KDP_STYLESHEET).toMatch(/\.diagram\s*\{/);
    expect(KDP_STYLESHEET).toMatch(/\.quiz-q\s*\{/);
  });

  it("styles rasterized math images distinctly from block diagram/cover images", () => {
    expect(KDP_STYLESHEET).toMatch(/img\.math-inline\s*\{[^}]*display:\s*inline-block/);
    expect(KDP_STYLESHEET).toMatch(/img\.math-block\s*\{[^}]*display:\s*block/);
  });
});
