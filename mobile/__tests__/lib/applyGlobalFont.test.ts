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

  it("treats large + bold text as a Playfair heading", () => {
    expect(resolveFamilyForStyle({ fontSize: 28, fontWeight: "700" }, false)).toBe(
      "PlayfairDisplay_600SemiBold",
    );
    // large but not bold → still body
    expect(resolveFamilyForStyle({ fontSize: 28, fontWeight: "400" }, false)).toBe(
      "Inter_400Regular",
    );
  });

  it("remaps explicit serif intent to Playfair (the heading resolver, not the bundled serif)", () => {
    expect(resolveFamilyForStyle({ fontFamily: "serif", fontWeight: "600" }, false)).toBe(
      "PlayfairDisplay_600SemiBold",
    );
    expect(resolveFamilyForStyle({ fontFamily: "Georgia" }, false)).toBe("PlayfairDisplay_400Regular");
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
  it("keeps the exact Fraunces instance (upright OR italic accent word) without a fontWeight", () => {
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_700Bold" }, false)).toBe("Fraunces_700Bold");
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_600SemiBold" }, false)).toBe(
      "Fraunces_600SemiBold",
    );
    // The italic accent word keeps its italic instance — not stripped to upright.
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_600SemiBold_Italic" }, false)).toBe(
      "Fraunces_600SemiBold_Italic",
    );
  });

  it("still swaps Fraunces headings AND the italic accent word to OpenDyslexic (a11y)", () => {
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_700Bold" }, true)).toBe("OpenDyslexic_700Bold");
    // Italic accent word yields to OpenDyslexic too (semibold rounds to bold).
    expect(resolveFamilyForStyle({ fontFamily: "Fraunces_600SemiBold_Italic" }, true)).toBe(
      "OpenDyslexic_700Bold",
    );
  });

  // Studio reskin P0: Playfair Display is the app-wide heading face. A literal
  // PlayfairDisplay_* family is heading-intent, mirroring the Fraunces branch.
  it("keeps the exact Playfair instance untouched when not dyslexic", () => {
    expect(resolveFamilyForStyle({ fontFamily: "PlayfairDisplay_600SemiBold" }, false)).toBe(
      "PlayfairDisplay_600SemiBold",
    );
    expect(resolveFamilyForStyle({ fontFamily: "PlayfairDisplay_400Regular" }, false)).toBe(
      "PlayfairDisplay_400Regular",
    );
  });

  it("swaps a Playfair heading to OpenDyslexic in dyslexic mode (a11y)", () => {
    // Unlike the Fraunces branch, the Playfair branch reads weight from the
    // style's fontWeight (not the family name) — no fontWeight here means the
    // regular bucket.
    expect(resolveFamilyForStyle({ fontFamily: "PlayfairDisplay_600SemiBold" }, true)).toBe(
      "OpenDyslexic_400Regular",
    );
    expect(
      resolveFamilyForStyle({ fontFamily: "PlayfairDisplay_600SemiBold", fontWeight: "600" }, true),
    ).toBe("OpenDyslexic_700Bold");
  });
});
