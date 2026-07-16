import { blockText } from "@/help";
import { FEATURES, HELP_TOPICS } from "@/help-content";
import { STARTER_SOURCES } from "@/openshelves/starterSources";
import type { HelpTopic } from "@/help";

// Help once told users "a few starter libraries are included, so you always have
// somewhere to start" and that "only the starter libraries are curated by us".
// Neither was true: ADR-028 D5's starter list was spec-only, so every source was
// one the user added themselves. (Fixed by the copy rescued from closed PR #304.)
//
// The existing coverage gate could not have caught it, and neither could its
// inverse — BOTH already exist and BOTH passed:
//   - every FEATURE has a topic                  (coverage.test.ts)
//   - every topic's featureKey is a real FEATURE (coverage.test.ts, since #277)
// `open-shelves` was a real declared feature and the topic carried its real key.
// The falsehood was a *sentence of prose asserting a capability*, which no
// featureKey mapping can see inside.
//
// What is mechanically checkable is the thing that actually went wrong: the
// CLAIM and the CAPABILITY drifting apart. STARTER_SOURCES is the whole curation
// surface (P0-5 design A1 — "the whole 'curation' surface is this array"), so it
// is the capability, and this ties the copy to it in both directions.
//
// When P0-5 ships and populates STARTER_SOURCES, this test FAILS until the help
// copy says so — which is the point. To satisfy it, describe the starter sources
// using one of CURATION_CLAIMS below (or extend that list if the new copy words
// it differently).

// Phrases that AFFIRMATIVELY promise owner-curated sources. Deliberately narrow:
// the legitimate copy says "outside Mentible's curation" and asks "Is a source
// curated?", so a bare /curat/ would flag honest text. Both original false claims
// contained the word "starter".
const CURATION_CLAIMS = [/starter/i, /curated by us/i, /we curate/i];

function promisesCuration(topic: HelpTopic): boolean {
  const text = `${topic.title} ${topic.keywords?.join(" ") ?? ""} ${blockText(topic.blocks)}`;
  return CURATION_CLAIMS.some((re) => re.test(text));
}

describe("help's curation claim tracks the starter-source capability", () => {
  it("promises curated/starter sources only when starter sources actually exist", () => {
    const promisers = HELP_TOPICS.filter(promisesCuration).map((t) => t.id);
    if (STARTER_SOURCES.length === 0) {
      // No capability → the copy must not promise one. This is the direction
      // that protects users, and the one that was violated.
      expect(promisers).toEqual([]);
    } else {
      // Capability shipped → the copy must say so, or nobody will find it.
      expect(promisers.length).toBeGreaterThan(0);
    }
  });

  it("the gate bites: a topic promising starter libraries is flagged", () => {
    const synthetic = {
      id: "synthetic-open-shelves",
      title: "Open Shelves",
      featureKey: FEATURES[0].key,
      keywords: [],
      blocks: [{ kind: "text" as const, text: "A few starter libraries are included." }],
    } as unknown as HelpTopic;
    expect(promisesCuration(synthetic)).toBe(true);
  });

  it("does not flag the honest copy's legitimate uses of 'curation'", () => {
    // Regression guard for the regex itself: these are true statements the fixed
    // copy makes, and must never trip the gate.
    const honest = {
      id: "honest",
      title: "Open Shelves",
      keywords: [],
      blocks: [
        { kind: "text" as const, text: "User-added sources are outside Mentible's curation." },
        { kind: "defs" as const, defs: [{ term: "Is a source curated?", def: "No. Every catalog is one you added yourself." }] },
      ],
    } as unknown as HelpTopic;
    expect(promisesCuration(honest)).toBe(false);
  });
});
