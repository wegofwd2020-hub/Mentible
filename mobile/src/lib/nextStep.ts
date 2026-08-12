// Which single next action moves an owner toward their first working AI draft.
// Pure + defensive: returns null for non-owners and once any draft exists
// (per-topic OR whole-book), so the banner retires the moment the goal is met.
export type NextStep = {
  key: "add_source" | "suggest_structure" | "generate_topic";
  title: string;
  body: string;
  ctaLabel: string;
  target: { phase: "capture" | "structure" | "create"; draftMode?: "topic" };
};

export function nextStep(args: {
  isOwner: boolean;
  inputCount: number;
  tocSubjectCount: number;
  anyDraftExists: boolean;
}): NextStep | null {
  if (!args.isOwner || args.anyDraftExists) return null;
  if (args.inputCount <= 0) {
    return {
      key: "add_source",
      title: "Add your first source",
      body: "The studio drafts only from what you provide — nothing invented.",
      ctaLabel: "Add a source",
      target: { phase: "capture" },
    };
  }
  if (args.tocSubjectCount <= 0) {
    return {
      key: "suggest_structure",
      title: "Suggest a structure",
      body: "Turn your sources into a table of contents to draft against.",
      ctaLabel: "Suggest a structure",
      target: { phase: "structure" },
    };
  }
  return {
    key: "generate_topic",
    title: "Generate your first topic",
    body: "Pick a topic and draft it from your sources.",
    ctaLabel: "Generate a topic",
    target: { phase: "create", draftMode: "topic" },
  };
}
