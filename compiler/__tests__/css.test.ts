import { STYLESHEET } from "../src/css";

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
});
