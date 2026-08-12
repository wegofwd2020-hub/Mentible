import { nextStep } from "@/lib/nextStep";

const base = { isOwner: true, inputCount: 0, tocSubjectCount: 0, anyDraftExists: false };

it("reviewer / non-owner gets no step", () => {
  expect(nextStep({ ...base, isOwner: false })).toBeNull();
});

it("owner with no sources → add_source (Input)", () => {
  const s = nextStep(base)!;
  expect(s.key).toBe("add_source");
  expect(s.target.phase).toBe("capture");
});

it("sources but no TOC → suggest_structure (Structure)", () => {
  const s = nextStep({ ...base, inputCount: 2 })!;
  expect(s.key).toBe("suggest_structure");
  expect(s.target.phase).toBe("structure");
});

it("TOC but nothing drafted → generate_topic (Drafts, per-topic)", () => {
  const s = nextStep({ ...base, inputCount: 2, tocSubjectCount: 1 })!;
  expect(s.key).toBe("generate_topic");
  expect(s.target).toEqual({ phase: "create", draftMode: "topic" });
});

it("a draft already exists (per-topic OR whole-book) → no step (goal reached)", () => {
  expect(nextStep({ isOwner: true, inputCount: 2, tocSubjectCount: 1, anyDraftExists: true })).toBeNull();
});

it("goal reached even with no TOC (e.g. a whole-book draft) → no step", () => {
  expect(nextStep({ isOwner: true, inputCount: 2, tocSubjectCount: 0, anyDraftExists: true })).toBeNull();
});
