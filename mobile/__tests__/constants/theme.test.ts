import { studioDarkColors, studioLightColors, radius } from "@/constants/theme";

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
