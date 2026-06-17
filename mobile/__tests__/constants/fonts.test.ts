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
});
