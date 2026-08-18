import { HELP_TOPICS, HELP_TREE } from "@/help-content";
import { ancestorIdsForTopic, flattenNodes, nodeIdForTopic, type HelpTreeNode } from "@/help";

// Topics that intentionally have no tree leaf (search-only). Empty today —
// every real topic must be reachable by navigating the tree.
const SEARCH_ONLY_ALLOWLIST: string[] = [];

// HelpButton `topic="<id>"` literals found across the app (grep for
// `topic="` under mobile/app and mobile/src, excluding tests) — every one
// must resolve to a reachable tree leaf so contextual "?" buttons keep
// working. See mobile/app/sign-in.tsx, paywall.tsx, (tabs)/settings.tsx,
// (tabs)/books.tsx, book/generate/[id].tsx, book/read/[id].tsx,
// book/saved/[id].tsx.
const KNOWN_HELP_BUTTON_TOPICS = [
  "getting-started-account",
  "plans",
  "provider-keys",
  "formats",
  "scoped-generation",
  "reading-a-book",
  "share-a-draft",
];

describe("HELP_TREE integrity", () => {
  const nodes = flattenNodes(HELP_TREE);
  const topicIds = new Set(HELP_TOPICS.map((t) => t.id));
  const treeTopicIds = new Set(
    nodes.map((n) => n.topicId).filter((id): id is string => Boolean(id)),
  );

  it("every node id is unique", () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every node.topicId resolves to a real HELP_TOPICS id", () => {
    for (const n of nodes) {
      if (n.topicId) expect(topicIds.has(n.topicId)).toBe(true);
    }
  });

  it("every HELP_TOPICS id is reachable as some node's topicId (or is explicitly allow-listed)", () => {
    const unreachable = HELP_TOPICS.map((t) => t.id).filter(
      (id) => !treeTopicIds.has(id) && !SEARCH_ONLY_ALLOWLIST.includes(id),
    );
    expect(unreachable).toEqual([]);
  });

  it("every known HelpButton topic literal is a reachable tree leaf", () => {
    const missing = KNOWN_HELP_BUTTON_TOPICS.filter((id) => !treeTopicIds.has(id));
    expect(missing).toEqual([]);
  });
});

describe("ancestorIdsForTopic", () => {
  it("returns the root-to-parent chain of branch ids for a nested leaf", () => {
    const tree: HelpTreeNode[] = [
      {
        id: "a",
        title: "A",
        children: [
          {
            id: "b",
            title: "B",
            children: [{ id: "c", title: "C", topicId: "leaf-topic" }],
          },
        ],
      },
    ];
    expect(ancestorIdsForTopic(tree, "leaf-topic")).toEqual(["a", "b"]);
  });

  it("returns an empty array when the topicId isn't in the tree", () => {
    const tree: HelpTreeNode[] = [{ id: "a", title: "A", topicId: "x" }];
    expect(ancestorIdsForTopic(tree, "missing")).toEqual([]);
  });

  it("resolves a real 3-level Projects leaf (Projects > Feedback > Read, approve & revise a draft)", () => {
    // The help.tsx ?topic=<id> deep link relies on this exact chain to expand
    // both the top-level "projects" branch and its "projects-feedback"
    // sub-branch before the leaf itself is reachable.
    expect(ancestorIdsForTopic(HELP_TREE, "draft-viewer")).toEqual([
      "projects",
      "projects-feedback",
    ]);
  });
});

describe("nodeIdForTopic", () => {
  // help.tsx's ?topic=<id> deep link must scroll by the tree-node id, not
  // the raw topicId (offsets.current is keyed by node.id, and every real
  // leaf's node id differs from its topicId — e.g. "leaf-plans" vs "plans").
  // These pin the exact ids so a future tree.ts edit can't silently break
  // that keying without a test noticing.
  it("resolves a top-level leaf's topicId to its tree-node id", () => {
    expect(nodeIdForTopic(HELP_TREE, "plans")).toBe("leaf-plans");
  });

  it("resolves a 3-level nested leaf's topicId to its tree-node id", () => {
    expect(nodeIdForTopic(HELP_TREE, "draft-viewer")).toBe("leaf-draft-viewer");
  });

  it("returns undefined when the topicId isn't in the tree", () => {
    expect(nodeIdForTopic(HELP_TREE, "not-a-real-topic")).toBeUndefined();
  });
});

describe("flattenNodes", () => {
  it("visits every node depth-first, branches before their children", () => {
    const tree: HelpTreeNode[] = [
      { id: "a", title: "A", children: [{ id: "b", title: "B", topicId: "x" }] },
      { id: "c", title: "C", topicId: "y" },
    ];
    expect(flattenNodes(tree).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});
