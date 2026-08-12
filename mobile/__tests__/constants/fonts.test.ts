import { resolveFamily } from "@/constants/fonts";

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

  describe("heading (Fraunces)", () => {
    it("maps weights to Fraunces, with medium rounding to regular (no bundled 500)", () => {
      expect(resolveFamily("heading", "400", false)).toBe("Fraunces_400Regular");
      expect(resolveFamily("heading", "500", false)).toBe("Fraunces_400Regular");
      expect(resolveFamily("heading", "600", false)).toBe("Fraunces_600SemiBold");
      expect(resolveFamily("heading", "700", false)).toBe("Fraunces_700Bold");
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

  // ADR-038 O2 originally added a `brand` arg to pick Fraunces vs the default
  // serif for headings. Studio reskin P0 retired that split (heading always
  // resolved to Playfair, regardless of `brand`); the Fraunces-gold pass then
  // pointed the heading branch itself at Fraunces — so a `brand` arg is still
  // ignored, it just lands on Fraunces either way. The param stays only for
  // call-site signature stability.
  describe("heading brand (retired — heading always resolves to Fraunces)", () => {
    it("ignores a `brand` arg entirely — heading is always Fraunces", () => {
      expect(resolveFamily("heading", "400", false, "fraunces")).toBe("Fraunces_400Regular");
      expect(resolveFamily("heading", "600", false, "fraunces")).toBe("Fraunces_600SemiBold");
      expect(resolveFamily("heading", "700", false, "fraunces")).toBe("Fraunces_700Bold");
    });
    it("brand only ever affected heading, never body", () => {
      expect(resolveFamily("body", "700", false, "fraunces")).toBe("Inter_700Bold");
    });
    it("dyslexic still overrides heading regardless of brand", () => {
      expect(resolveFamily("heading", "700", true, "fraunces")).toBe("OpenDyslexic_700Bold");
    });
  });
});
