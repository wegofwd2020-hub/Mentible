import { groupIntoShelves } from "@/lib/groupShelves";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";

function book(id: string): EpubMeta {
  return { id, title: id, sizeBytes: 1, compiledAt: "2026-07-04T00:00:00Z" };
}
function shelf(id: string, order: number): Shelf {
  return { id, name: id, createdAt: "2026-07-04T00:00:00Z", order };
}

it("orders shelves by order and includes empty shelves", () => {
  const shelves = [shelf("s2", 1), shelf("s1", 0)];
  const sections = groupIntoShelves([book("b1")], shelves, { b1: "s1" });
  expect(sections.map((sec) => sec.shelf?.id)).toEqual(["s1", "s2"]);
  expect(sections[0].books.map((b) => b.id)).toEqual(["b1"]);
  expect(sections[1].books).toEqual([]); // s2 empty but present
});

it("puts unassigned and stale-pointer books in a trailing Unshelved section", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves(
    [book("b1"), book("b2"), book("b3")],
    shelves,
    { b1: "s1", b2: "ghost" }, // b2 points at a deleted shelf, b3 unassigned
  );
  const unshelved = sections.find((sec) => sec.shelf === null);
  expect(unshelved?.books.map((b) => b.id)).toEqual(["b2", "b3"]);
});

it("omits the Unshelved section when every book is shelved", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves([book("b1")], shelves, { b1: "s1" });
  expect(sections.some((sec) => sec.shelf === null)).toBe(false);
});

it("preserves input book order within a section", () => {
  const shelves = [shelf("s1", 0)];
  const sections = groupIntoShelves([book("z"), book("a")], shelves, { z: "s1", a: "s1" });
  expect(sections[0].books.map((b) => b.id)).toEqual(["z", "a"]);
});
