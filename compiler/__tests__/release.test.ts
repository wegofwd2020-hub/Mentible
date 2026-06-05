import { watermarkText, editionLabel, isDraft } from "../src/release";

// Release-lifecycle helpers (ADR-008) drive the draft watermark + edition stamp.
describe("release lifecycle helpers", () => {
  it("draft → DRAFT watermark and label", () => {
    const m = { status: "draft" as const };
    expect(watermarkText(m)).toBe("DRAFT");
    expect(editionLabel(m)).toBe("DRAFT");
    expect(isDraft(m)).toBe(true);
  });

  it("an explicit watermark string overrides (and works without draft status)", () => {
    expect(watermarkText({ watermark: "CONFIDENTIAL" })).toBe("CONFIDENTIAL");
    expect(isDraft({ watermark: "REVIEW COPY" })).toBe(true);
  });

  it("release → no watermark, 'vX · Edition' label", () => {
    const m = { status: "release" as const, version: "1.0", edition: "First Edition" };
    expect(watermarkText(m)).toBe("");
    expect(editionLabel(m)).toBe("v1.0 · First Edition");
    expect(isDraft(m)).toBe(false);
  });

  it("absent metadata → no watermark, no label", () => {
    expect(watermarkText(undefined)).toBe("");
    expect(editionLabel(undefined)).toBe("");
    expect(isDraft(undefined)).toBe(false);
  });
});
