import {
  studioDarkColors,
  studioLightColors,
  manuscriptColors,
  colors,
  radius,
  mix,
} from "@/constants/theme";

describe("theme tokens — studio gold + radii (visual pass)", () => {
  it("studioDarkColors uses the warmer mid-gold", () => {
    expect(studioDarkColors.primary).toBe("#D6A94B");
  });

  it("studioLightColors gold is unchanged", () => {
    expect(studioLightColors.primary).toBe("#8A6A22");
  });

  it("radius.md and radius.lg are rounder", () => {
    expect(radius.md).toBe(14);
    expect(radius.lg).toBe(22);
  });
});

describe("mix()", () => {
  it("blends two hex colors at t=0.5", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("returns hexA at t=0", () => {
    expect(mix("#112233", "#ffffff", 0)).toBe("#112233");
  });

  it("returns hexB at t=1", () => {
    expect(mix("#112233", "#ffffff", 1)).toBe("#ffffff");
  });

  it("clamps t below 0 and above 1", () => {
    expect(mix("#000000", "#ffffff", -5)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 5)).toBe("#ffffff");
  });

  it("throws on an invalid hex", () => {
    expect(() => mix("not-a-color", "#ffffff", 0.5)).toThrow();
  });
});

describe("bgGradientEnd", () => {
  it("is a warm-gold-tinted background on the studio palettes", () => {
    expect(studioLightColors.bgGradientEnd).toBe(mix(studioLightColors.background, "#D6A94B", 0.15));
    expect(studioDarkColors.bgGradientEnd).toBe(mix(studioDarkColors.background, "#D6A94B", 0.15));
    expect(studioLightColors.bgGradientEnd).not.toBe(studioLightColors.background);
    expect(studioDarkColors.bgGradientEnd).not.toBe(studioDarkColors.background);
  });

  it("is flat (== background) on the other, non-studio palettes", () => {
    expect(manuscriptColors.bgGradientEnd).toBe(manuscriptColors.background);
    expect((colors as unknown as { bgGradientEnd?: string }).bgGradientEnd).toBe(colors.background);
  });
});
