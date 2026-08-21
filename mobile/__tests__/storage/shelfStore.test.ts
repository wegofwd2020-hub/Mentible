import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  assignBook,
  createShelf,
  deleteShelf,
  exportShelvesDoc,
  getAssignments,
  importShelvesDoc,
  listShelves,
  pruneBook,
  renameShelf,
  subscribeShelfStore,
} from "@/storage/shelfStore";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("shelfStore — shelves", () => {
  it("creates shelves with incrementing order", async () => {
    const a = await createShelf("Physics");
    const b = await createShelf("Chemistry");
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(a.id).not.toBe(b.id);
    const list = await listShelves();
    expect(list.map((s) => s.name)).toEqual(["Physics", "Chemistry"]);
  });

  it("trims names and rejects empty ones", async () => {
    const s = await createShelf("  Biology  ");
    expect(s.name).toBe("Biology");
    await expect(createShelf("   ")).rejects.toThrow();
  });

  it("renames a shelf and rejects an empty rename", async () => {
    const s = await createShelf("Phys");
    await renameShelf(s.id, "Physics");
    expect((await listShelves())[0].name).toBe("Physics");
    await expect(renameShelf(s.id, "  ")).rejects.toThrow();
  });

  it("returns shelves sorted by order regardless of stored order", async () => {
    const a = await createShelf("A");
    const b = await createShelf("B");
    // Persist them reversed to prove listShelves sorts.
    await AsyncStorage.setItem("sbq_shelves", JSON.stringify([b, a]));
    expect((await listShelves()).map((s) => s.order)).toEqual([0, 1]);
  });

  it("survives malformed stored JSON", async () => {
    await AsyncStorage.setItem("sbq_shelves", "{not json");
    expect(await listShelves()).toEqual([]);
    await AsyncStorage.setItem("sbq_shelf_assignments", "nope");
    expect(await getAssignments()).toEqual({});
  });
});

describe("shelfStore — assignments", () => {
  it("assigns, reassigns (one shelf at a time), and unshelves", async () => {
    await assignBook("book1", "shelfA");
    expect(await getAssignments()).toEqual({ book1: "shelfA" });
    await assignBook("book1", "shelfB"); // reassign replaces, never duplicates
    expect(await getAssignments()).toEqual({ book1: "shelfB" });
    await assignBook("book1", null); // unshelve removes the key
    expect(await getAssignments()).toEqual({});
  });

  it("pruneBook drops only that book's assignment", async () => {
    await assignBook("b1", "s1");
    await assignBook("b2", "s1");
    await pruneBook("b1");
    expect(await getAssignments()).toEqual({ b2: "s1" });
  });

  it("deleteShelf removes the shelf and unshelves its books, leaving others", async () => {
    const s1 = await createShelf("S1");
    const s2 = await createShelf("S2");
    await assignBook("b1", s1.id);
    await assignBook("b2", s1.id);
    await assignBook("b3", s2.id);
    await deleteShelf(s1.id);
    expect((await listShelves()).map((s) => s.id)).toEqual([s2.id]);
    expect(await getAssignments()).toEqual({ b3: s2.id }); // b1,b2 unshelved
  });
});

describe("shelfStore — sync doc (ADR-014 increment 2)", () => {
  it("exportShelvesDoc defaults updatedAt to the epoch when never touched", async () => {
    const doc = await exportShelvesDoc();
    expect(doc).toEqual({ shelves: [], assignments: {}, updatedAt: new Date(0).toISOString() });
  });

  it("every mutating fn bumps updatedAt on the exported doc", async () => {
    const before = await exportShelvesDoc();
    const s = await createShelf("Physics");
    const afterCreate = await exportShelvesDoc();
    expect(Date.parse(afterCreate.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));

    await renameShelf(s.id, "Physics 101");
    const afterRename = await exportShelvesDoc();
    expect(Date.parse(afterRename.updatedAt)).toBeGreaterThanOrEqual(Date.parse(afterCreate.updatedAt));

    await assignBook("b1", s.id);
    const afterAssign = await exportShelvesDoc();
    expect(Date.parse(afterAssign.updatedAt)).toBeGreaterThanOrEqual(Date.parse(afterRename.updatedAt));

    await deleteShelf(s.id);
    const afterDelete = await exportShelvesDoc();
    expect(Date.parse(afterDelete.updatedAt)).toBeGreaterThanOrEqual(Date.parse(afterAssign.updatedAt));
  });

  it("importShelvesDoc round-trips shelves + assignments + updatedAt exactly", async () => {
    const doc = {
      shelves: [{ id: "s1", name: "Physics", createdAt: "2026-01-01T00:00:00.000Z", order: 0 }],
      assignments: { b1: "s1" },
      updatedAt: "2026-05-01T00:00:00.000Z",
    };

    await importShelvesDoc(doc);

    expect(await exportShelvesDoc()).toEqual(doc);
    expect(await listShelves()).toEqual(doc.shelves);
    expect(await getAssignments()).toEqual(doc.assignments);
  });

  it("importShelvesDoc does NOT bump updatedAt to 'now' — it adopts the pulled clock verbatim", async () => {
    const pastUpdatedAt = "2020-01-01T00:00:00.000Z"; // older than "now" by construction
    await importShelvesDoc({ shelves: [], assignments: {}, updatedAt: pastUpdatedAt });
    expect((await exportShelvesDoc()).updatedAt).toBe(pastUpdatedAt);
  });
});

describe("shelfStore — subscribeShelfStore", () => {
  it("fires the listener on every mutating fn (create/rename/assign/delete) and importShelvesDoc", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeShelfStore(listener);

    const s = await createShelf("Physics");
    expect(listener).toHaveBeenCalledTimes(1);

    await renameShelf(s.id, "Physics 101");
    expect(listener).toHaveBeenCalledTimes(2);

    await assignBook("b1", s.id);
    expect(listener).toHaveBeenCalledTimes(3);

    await deleteShelf(s.id);
    expect(listener).toHaveBeenCalledTimes(4);

    await importShelvesDoc({ shelves: [], assignments: {}, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(listener).toHaveBeenCalledTimes(5);

    unsubscribe();
    await createShelf("After unsubscribe");
    expect(listener).toHaveBeenCalledTimes(5); // no further calls once unsubscribed
  });

  it("a throwing listener does not break the mutation it was notified of", async () => {
    const throwing = jest.fn(() => {
      throw new Error("listener boom");
    });
    subscribeShelfStore(throwing);

    await expect(createShelf("Chemistry")).resolves.toBeDefined();
    expect(throwing).toHaveBeenCalled();
    expect((await listShelves()).map((s) => s.name)).toContain("Chemistry");
  });
});
