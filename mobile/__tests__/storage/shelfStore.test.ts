import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  assignBook,
  createShelf,
  deleteShelf,
  getAssignments,
  listShelves,
  pruneBook,
  renameShelf,
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
