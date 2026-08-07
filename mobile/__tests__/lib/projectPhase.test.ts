import { deriveProjectPhase, PHASE_LABELS } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: Partial<any> = {}) =>
  ({
    project: { id: "p1", title: "P", topic: null, toc: { subjects: [{ subject_label: "S1", units: [] }] } },
    my_role: "owner",
    artifacts: [],
    inputs: [],
    ...over,
  }) as any;
const artifact = (id: string, is_validated: boolean | null) => ({
  artifact: { id, title: id, role: "cornerstone", format: "guide" },
  versions: is_validated === null ? [] : [{ id: id + "v", version_no: 1, is_validated, recorded_via: null }],
});

it("labels map phases to content nouns", () => {
  expect(PHASE_LABELS).toEqual({
    capture: "Input",
    structure: "Structure",
    create: "Drafts",
    validate: "Feedback",
    share: "Publish",
  });
});

it("no inputs → capture current", () => {
  const p = deriveProjectPhase(detail(), true);
  expect(p.currentKey).toBe("capture");
  expect(p.phases.find((x) => x.key === "capture")!.done).toBe(false);
});

it("inputs but no artifact → create_artifact", () => {
  expect(deriveProjectPhase(detail({ inputs: [input] }), true).currentKey).toBe("create_artifact");
});

it("inputs + an empty artifact → create", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", null)] }), true).currentKey).toBe("create");
});

it("a version, none validated → validate", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", false)] }), true).currentKey).toBe("validate");
});

it("all artifacts validated → share (capture/create/validate done)", () => {
  const p = deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", true)] }), true);
  expect(p.currentKey).toBe("share");
  expect(p.phases.filter((x) => x.done).map((x) => x.key)).toEqual(["capture", "structure", "create", "validate"]);
});

it("one validated + a second unvalidated artifact → still validate, not share", () => {
  expect(deriveProjectPhase(detail({ inputs: [input], artifacts: [artifact("A", true), artifact("B", false)] }), true).currentKey).toBe("validate");
});
