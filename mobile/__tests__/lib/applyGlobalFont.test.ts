import { resolveFamilyForStyle } from "@/lib/applyGlobalFont";

describe("resolveFamilyForStyle", () => {
  it("leaves icon fonts untouched (the Ionicons → CJK regression)", () => {
    // @expo/vector-icons renders glyphs as <Text fontFamily="Ionicons">; overriding
    // it would turn icons into tofu/CJK characters.
    expect(resolveFamilyForStyle({ fontFamily: "Ionicons" }, false)).toBeNull();
    expect(resolveFamilyForStyle({ fontFamily: "MaterialCommunityIcons" }, false)).toBeNull();
    // Even in dyslexic mode icons must stay icons.
    expect(resolveFamilyForStyle({ fontFamily: "Ionicons" }, true)).toBeNull();
  });

  it("leaves monospace and other deliberate families untouched", () => {
    expect(resolveFamilyForStyle({ fontFamily: "monospace" }, false)).toBeNull();
    expect(resolveFamilyForStyle({ fontFamily: "monospace" }, true)).toBeNull();
  });

  it("maps unstyled text to Inter by weight", () => {
    expect(resolveFamilyForStyle({}, false)).toBe("Inter_400Regular");
    expect(resolveFamilyForStyle({ fontWeight: "700" }, false)).toBe("Inter_700Bold");
  });

  it("treats large + bold text as a serif heading", () => {
    expect(resolveFamilyForStyle({ fontSize: 28, fontWeight: "700" }, false)).toBe(
      "SourceSerif4_700Bold",
    );
    // large but not bold → still body
    expect(resolveFamilyForStyle({ fontSize: 28, fontWeight: "400" }, false)).toBe(
      "Inter_400Regular",
    );
  });

  it("remaps explicit serif intent to the bundled serif", () => {
    expect(resolveFamilyForStyle({ fontFamily: "serif", fontWeight: "600" }, false)).toBe(
      "SourceSerif4_600SemiBold",
    );
    expect(resolveFamilyForStyle({ fontFamily: "Georgia" }, false)).toBe("SourceSerif4_400Regular");
  });

  it("swaps text families to OpenDyslexic in dyslexic mode", () => {
    expect(resolveFamilyForStyle({}, true)).toBe("OpenDyslexic_400Regular");
    expect(resolveFamilyForStyle({ fontSize: 28, fontWeight: "700" }, true)).toBe(
      "OpenDyslexic_700Bold",
    );
  });

  // ADR-038 O2: SME heading styles set a concrete Fraunces family and NO fontWeight
  // (the weight is baked into the name; a redundant fontWeight would faux-bold on
  // web). The interceptor derives the weight from the family name, keeps it Fraunces
  // on native, and still lets dyslexic mode override it (a11y).
  it("resolves an explicit Fraunces family by its baked weight, without a fontWeight", () => {
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_700Bold" }, false)).toBe("Fraunces_700Bold");
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_600SemiBold" }, false)).toBe(
      "Fraunces_600SemiBold",
    );
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_400Regular" }, false)).toBe(
      "Fraunces_400Regular",
    );
  });

  it("still swaps Fraunces headings to OpenDyslexic in dyslexic mode (by baked weight)", () => {
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_700Bold" }, true)).toBe("OpenDyslexic_700Bold");
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_400Regular" }, true)).toBe(
      "OpenDyslexic_400Regular",
    );
  });
});
