import { resolveFamily, FONT_ASSETS } from "@/constants/fonts";

it("heading role resolves to Playfair per weight bucket", () => {
  expect(resolveFamily("heading", "400", false)).toBe("PlayfairDisplay_400Regular");
  expect(resolveFamily("heading", "500", false)).toBe("PlayfairDisplay_500Medium");
  expect(resolveFamily("heading", "700", false)).toBe("PlayfairDisplay_600SemiBold");
  // body unchanged
  expect(resolveFamily("body", "400", false)).toBe("Inter_400Regular");
  // dyslexic still overrides heading
  expect(resolveFamily("heading", "400", true)).toBe("OpenDyslexic_400Regular");
});

it("Playfair faces are registered for useFonts", () => {
  expect(FONT_ASSETS).toHaveProperty("PlayfairDisplay_400Regular");
  expect(FONT_ASSETS).toHaveProperty("PlayfairDisplay_500Medium");
});
