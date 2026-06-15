import { bundledBooks } from "@/storage/bundledLibrary";

// Guards that the bundled assets actually resolve and that every manifest entry
// is wired into FILE_MODULES (a missing file would be dropped, shrinking this
// list). Also pins the cert guide's current shipped state.
describe("bundledLibrary registry", () => {
  it("resolves every manifest entry to a bundled book with raw JSON", () => {
    expect(bundledBooks.length).toBeGreaterThan(0);
    for (const b of bundledBooks) {
      expect(typeof b.id).toBe("string");
      expect(["draft", "published"]).toContain(b.status);
      // raw must be parseable JSON carrying the same id.
      const parsed = JSON.parse(b.raw);
      expect(parsed.id).toBe(b.id);
    }
  });

  it("ships the Claude Certified Architect guide as a draft (not yet a default)", () => {
    const cert = bundledBooks.find((b) => b.id === "claude-cert-architect-foundations");
    expect(cert).toBeDefined();
    expect(cert?.status).toBe("draft");
  });
});
