// planReconcile is the PURE classifier lifted out of syncNow's reconcile
// loop (syncEngine.ts). One test per branch of the original 6-branch
// classification — these pin the exact behavior so the syncNow refactor
// (which now just calls planReconcile + executes the plan) can be verified
// against them, and so syncStatus (a read-only consumer of the same
// classifier) inherits the same semantics without re-deriving them.
import { planReconcile } from "@/sync/syncEngine";

const S = (bookId: string, o: Partial<{ clientVersion: string; deleted: boolean; updatedAt: string }> = {}) => ({
  bookId,
  clientVersion: o.clientVersion ?? "2026-01-01T00:00:00.000Z",
  deleted: o.deleted ?? false,
  updatedAt: o.updatedAt ?? "2026-01-01T00:00:00.000Z",
});
const L = (id: string, updatedAt = "2026-01-01T00:00:00.000Z") => ({ id, updatedAt });

it("local-only → toPush", () => {
  expect(planReconcile([L("a")], [], new Set()).toPush).toEqual(["a"]);
});

it("local newer than live server → toPush; server newer → toPull; equal → equalKeep only", () => {
  const newer = "2026-02-01T00:00:00.000Z", older = "2025-12-01T00:00:00.000Z";
  expect(planReconcile([L("a", newer)], [S("a")], new Set()).toPush).toEqual(["a"]);
  expect(planReconcile([L("a", older)], [S("a")], new Set()).toPull).toEqual(["a"]);

  // cmp === 0 (live-both, equal timestamps): nothing to transfer, but the id
  // must land in `equalKeep` and NOWHERE else — this is what lets syncNow
  // restore the shadow membership these ids always had (the fix for the
  // delete-resurrection regression: an id missing from every list meant
  // syncNow never re-added it to the shadow on an empty/lost-shadow resync).
  const eq = planReconcile([L("a")], [S("a")], new Set());
  expect(eq.equalKeep).toEqual(["a"]);
  expect(eq.toPush).toEqual([]);
  expect(eq.toPull).toEqual([]);
  expect(eq.toDeleteLocal).toEqual([]);
  expect(eq.toPushDelete).toEqual([]);
  expect(eq.shadowDrop).toEqual([]);
});

it("server tombstone newer-or-equal → toDeleteLocal; local edited after tombstone → toPush", () => {
  const tomb = "2026-03-01T00:00:00.000Z";
  expect(
    planReconcile([L("a", "2026-01-01T00:00:00.000Z")], [S("a", { deleted: true, updatedAt: tomb })], new Set()).toDeleteLocal,
  ).toEqual(["a"]);
  expect(
    planReconcile([L("a", "2026-04-01T00:00:00.000Z")], [S("a", { deleted: true, updatedAt: tomb })], new Set()).toPush,
  ).toEqual(["a"]);
});

it("server-live not-in-shadow → toPull (peer add); in-shadow local-gone → toPushDelete", () => {
  expect(planReconcile([], [S("a")], new Set()).toPull).toEqual(["a"]);
  expect(planReconcile([], [S("a")], new Set(["a"])).toPushDelete).toEqual(["a"]);
});

it("both gone / stale shadow → shadowDrop, no action", () => {
  expect(planReconcile([], [S("a", { deleted: true })], new Set(["a"])).shadowDrop).toContain("a");
  expect(planReconcile([], [], new Set(["a"])).shadowDrop).toContain("a");
});
