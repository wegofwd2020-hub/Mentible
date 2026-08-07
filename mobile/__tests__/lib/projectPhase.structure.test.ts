import { deriveProjectPhase, PHASE_LABELS, PHASE_ORDER } from "@/lib/projectPhase";

const input = { id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null };
const detail = (over: Partial<any> = {}) =>
  ({ project: { id: "p1", title: "P", topic: null }, my_role: "owner", artifacts: [], inputs: [], ...over }) as any;

it("PHASE_ORDER inserts structure after capture", () => {
  expect(PHASE_ORDER).toEqual(["capture", "structure", "create", "validate", "share"]);
});

it("PHASE_LABELS.structure is Structure", () => {
  expect(PHASE_LABELS.structure).toBe("Structure");
});

it("toc with subjects → structure done", () => {
  const p = deriveProjectPhase(
    detail({
      inputs: [input],
      project: { id: "p1", title: "P", topic: null, toc: { subjects: [{ subject_label: "S1", units: [] }] } },
    }),
    true,
  );
  expect(p.phases.find((x) => x.key === "structure")!.done).toBe(true);
});

it("no toc → structure not done", () => {
  const p = deriveProjectPhase(detail({ inputs: [input] }), true);
  expect(p.phases.find((x) => x.key === "structure")!.done).toBe(false);
});

it("empty toc subjects → structure not done", () => {
  const p = deriveProjectPhase(
    detail({ inputs: [input], project: { id: "p1", title: "P", topic: null, toc: { subjects: [] } } }),
    true,
  );
  expect(p.phases.find((x) => x.key === "structure")!.done).toBe(false);
});
