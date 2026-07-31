import { resolveFamily, FRAUNCES } from "@/constants/fonts";

describe("resolveFamily", () => {
  describe("body (Inter)", () => {
    it("maps weights to the matching Inter family", () => {
      expect(resolveFamily("body", "400", false)).toBe("Inter_400Regular");
      expect(resolveFamily("body", "500", false)).toBe("Inter_500Medium");
      expect(resolveFamily("body", "600", false)).toBe("Inter_600SemiBold");
      expect(resolveFamily("body", "700", false)).toBe("Inter_700Bold");
    });

    it("treats undefined weight as regular and 'bold' as 700", () => {
      expect(resolveFamily("body", undefined, false)).toBe("Inter_400Regular");
      expect(resolveFamily("body", "bold", false)).toBe("Inter_700Bold");
      expect(resolveFamily("body", 700, false)).toBe("Inter_700Bold");
    });
  });

  describe("heading (Source Serif 4)", () => {
    it("maps weights to serif, rounding medium down to regular", () => {
      expect(resolveFamily("heading", "400", false)).toBe("SourceSerif4_400Regular");
      expect(resolveFamily("heading", "500", false)).toBe("SourceSerif4_400Regular");
      expect(resolveFamily("heading", "600", false)).toBe("SourceSerif4_600SemiBold");
      expect(resolveFamily("heading", "700", false)).toBe("SourceSerif4_700Bold");
    });
  });

  describe("dyslexic mode", () => {
    it("overrides both roles with OpenDyslexic (Regular/Bold only)", () => {
      expect(resolveFamily("body", "400", true)).toBe("OpenDyslexic_400Regular");
      expect(resolveFamily("heading", "400", true)).toBe("OpenDyslexic_400Regular");
      expect(resolveFamily("body", "700", true)).toBe("OpenDyslexic_700Bold");
      expect(resolveFamily("heading", "600", true)).toBe("OpenDyslexic_700Bold");
    });
  });

  // ADR-038 O2: the SME surfaces render headings in Fraunces. A `brand` arg
  // selects the heading family; it defaults to the serif so every existing
  // 3-arg caller is unchanged.
  describe("heading brand (Fraunces vs default serif)", () => {
    it("defaults to Source Serif 4 when no brand is given", () => {
      expect(resolveFamily("heading", "700", false)).toBe("SourceSerif4_700Bold");
    });
    it("maps heading weights to Fraunces when brand is fraunces", () => {
      expect(resolveFamily("heading", "400", false, "fraunces")).toBe(FRAUNCES.regular);
      expect(resolveFamily("heading", "600", false, "fraunces")).toBe(FRAUNCES.semibold);
      expect(resolveFamily("heading", "700", false, "fraunces")).toBe(FRAUNCES.bold);
    });
    it("brand only affects heading, never body", () => {
      expect(resolveFamily("body", "700", false, "fraunces")).toBe("Inter_700Bold");
    });
    it("dyslexic still overrides Fraunces headings (a11y preserved)", () => {
      expect(resolveFamily("heading", "700", true, "fraunces")).toBe("OpenDyslexic_700Bold");
    });
  });
});
