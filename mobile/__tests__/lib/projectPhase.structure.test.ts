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

it("no toc but a version already exists → structure skip-satisfied (done), pointer past structure", () => {
  const p = deriveProjectPhase(
    detail({
      inputs: [input],
      artifacts: [
        {
          artifact: { id: "a", title: "A", role: "cornerstone", format: "guide" },
          versions: [{ id: "v1", version_no: 1, created_at: null, is_validated: false, recorded_via: null }],
        },
      ],
    }),
    true,
  );
  expect(p.phases.find((x) => x.key === "structure")!.done).toBe(true);
  expect(p.currentKey).not.toBe("structure");
});
