import { resolveFamily, FONT_ASSETS } from "@/constants/fonts";

it("heading role resolves to Fraunces per weight bucket", () => {
  expect(resolveFamily("heading", "400", false)).toBe("Fraunces_400Regular");
  expect(resolveFamily("heading", "500", false)).toBe("Fraunces_400Regular");
  expect(resolveFamily("heading", "700", false)).toBe("Fraunces_700Bold");
  // body unchanged
  expect(resolveFamily("body", "400", false)).toBe("Inter_400Regular");
  // dyslexic still overrides heading
  expect(resolveFamily("heading", "400", true)).toBe("OpenDyslexic_400Regular");
});

it("Fraunces faces are registered for useFonts", () => {
  expect(FONT_ASSETS).toHaveProperty("Fraunces_400Regular");
  expect(FONT_ASSETS).toHaveProperty("Fraunces_600SemiBold");
});
