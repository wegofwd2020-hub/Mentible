import { buildCardSvg, type CardInput } from "../src/card";

const base: Omit<CardInput, "size"> = { headline: "Trust is the product", subtext: "Every claim traces to a source.", source_label: "Based on 3 cited sources" };

it("renders each size with the right viewBox and the card text", () => {
  const dims = { square: [1080, 1080], linkedin: [1200, 627], story: [1080, 1920] } as const;
  for (const size of ["square", "linkedin", "story"] as const) {
    const svg = buildCardSvg({ ...base, size });
    expect(svg).toContain(`viewBox="0 0 ${dims[size][0]} ${dims[size][1]}"`);
    expect(svg).toContain("Trust is the product");
    expect(svg).toContain("Every claim traces to a source.");
    expect(svg).toContain("Based on 3 cited sources");
  }
});

it("omits the source label line when absent", () => {
  const svg = buildCardSvg({ headline: "H", subtext: "S", size: "square" });
  expect(svg).toContain("H");
  expect(svg).not.toContain("Based on");
});

it("escapes XML-special characters in the text", () => {
  const svg = buildCardSvg({ headline: "A & B <x>", subtext: "S", size: "square" });
  expect(svg).toContain("A &amp; B &lt;x&gt;");
});
