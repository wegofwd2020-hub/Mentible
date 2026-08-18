import type { HelpTreeNode } from "./schema";

// Every node in the tree, depth-first — a branch is visited before its own
// children.
export function flattenNodes(tree: HelpTreeNode[]): HelpTreeNode[] {
  const out: HelpTreeNode[] = [];
  const walk = (nodes: HelpTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// The ids of every ANCESTOR branch of the node whose `topicId` matches
// `topicId`, in root-to-parent order (the matching node itself is excluded).
// Returns [] if no node in the tree carries that topicId.
export function ancestorIdsForTopic(tree: HelpTreeNode[], topicId: string): string[] {
  const path: string[] = [];
  const search = (nodes: HelpTreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.topicId === topicId) return true;
      if (n.children && search(n.children)) {
        path.unshift(n.id);
        return true;
      }
    }
    return false;
  };
  return search(tree) ? path : [];
}
