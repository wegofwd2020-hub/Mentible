import { PLAYFAIR_FONTFACE } from "../src/playfairFont";

it("declares Playfair Display 400+500 with embedded data URIs", () => {
  expect(PLAYFAIR_FONTFACE).toContain("font-family:'Playfair Display'");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:400");
  expect(PLAYFAIR_FONTFACE).toContain("font-weight:500");
  expect((PLAYFAIR_FONTFACE.match(/src:url\(data:font/g) || []).length).toBe(2);
});
