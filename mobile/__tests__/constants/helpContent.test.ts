import { HELP_TOPICS, searchHelpTopics } from "../../src/constants/helpContent";
import type { StepId } from "../../src/onboarding/firstRunState";

describe("searchHelpTopics", () => {
  it("returns all topics for an empty / whitespace query", () => {
    expect(searchHelpTopics("")).toHaveLength(HELP_TOPICS.length);
    expect(searchHelpTopics("   ")).toHaveLength(HELP_TOPICS.length);
  });

  it("is case-insensitive and matches visible text", () => {
    const ids = searchHelpTopics("OFFLINE").map((t) => t.id);
    expect(ids).toContain("troubleshooting");
  });

  it("matches the topic title", () => {
    expect(searchHelpTopics("glossary").map((t) => t.id)).toContain("glossary");
  });

  it("matches keywords that aren't in the visible prose", () => {
    // "billing" is a keyword on the provider-keys topic but not in its body text.
    expect(searchHelpTopics("billing").map((t) => t.id)).toContain("provider-keys");
  });

  it("returns nothing for an unrelated query", () => {
    expect(searchHelpTopics("xyzzy-not-a-term")).toHaveLength(0);
  });
});

describe("getting-started topic (onboarding polish)", () => {
  const topic = HELP_TOPICS.find((t) => t.id === "getting-started");

  it("exists", () => {
    expect(topic).toBeDefined();
  });

  it("mentions the two bundled books readable without an account/key", () => {
    const text = JSON.stringify(topic);
    expect(text).toMatch(/two finished books/i);
    expect(text).toMatch(/Library/);
    expect(text).toMatch(/no account or key needed/i);
  });

  it("is provider-neutral — no longer hard-codes 'Add your Anthropic API key'", () => {
    expect(JSON.stringify(topic)).not.toContain("Add your Anthropic API key");
  });

  it("relaunches the signup and key wizard steps via action blocks", () => {
    const steps = (topic?.blocks ?? [])
      .filter((b): b is { kind: "action"; label: string; step: StepId } => b.kind === "action")
      .map((b) => b.step);
    expect(steps).toEqual(expect.arrayContaining(["signup", "key"]));
  });

  it("is discoverable by a 'books' search", () => {
    expect(searchHelpTopics("books").map((t) => t.id)).toContain("getting-started");
  });
});

describe("no Android-specific wording in Help copy", () => {
  it("no topic body says 'Android Keystore' or 'device keystore'", () => {
    const all = JSON.stringify(HELP_TOPICS);
    expect(all).not.toContain("Android Keystore");
    expect(all).not.toContain("device keystore");
  });
});
