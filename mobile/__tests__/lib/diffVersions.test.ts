import { diffVersions } from "@/lib/diffVersions";

const S = (heading: string, body: string) => ({ heading, body });

it("classifies added / removed / changed / unchanged by heading", () => {
  const prev = [S("Intro", "a"), S("Body", "x"), S("Gone", "z")];
  const curr = [S("Intro", "a"), S("Body", "y"), S("New", "n")];
  const d = diffVersions(prev, curr);
  const by = Object.fromEntries(d.map((x) => [x.heading, x.status]));
  expect(by).toEqual({ Intro: "unchanged", Body: "changed", Gone: "removed", New: "added" });
});

it("is order-independent (reorder with same bodies = all unchanged)", () => {
  const a = [S("One", "1"), S("Two", "2")];
  const b = [S("Two", "2"), S("One", "1")];
  expect(diffVersions(a, b).every((x) => x.status === "unchanged")).toBe(true);
});

it("empty prev → all added", () => {
  expect(diffVersions([], [S("X", "x")])).toEqual([{ heading: "X", status: "added" }]);
});
