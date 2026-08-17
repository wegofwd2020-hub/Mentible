import { parseArgs } from "../src/cli";

describe("parseArgs — --profile", () => {
  it("defaults to profile 'default' when --profile is omitted", () => {
    expect(parseArgs(["book.json"]).profile).toBe("default");
  });

  it("parses --profile kdp", () => {
    expect(parseArgs(["book.json", "--profile", "kdp"]).profile).toBe("kdp");
  });

  it("falls back to 'default' for an unrecognized --profile value", () => {
    expect(parseArgs(["book.json", "--profile", "bogus"]).profile).toBe("default");
  });

  it("still parses --format and --mermaid alongside --profile", () => {
    const args = parseArgs(["book.json", "--format", "epub", "--mermaid", "--profile", "kdp"]);
    expect(args).toMatchObject({ format: "epub", mermaid: true, profile: "kdp" });
  });
});
