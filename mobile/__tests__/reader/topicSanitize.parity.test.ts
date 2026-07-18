/** @jest-environment jsdom */
// The web hook (real function) and the native hook (hand-authored JS string) are
// two copies of one algorithm. This pins them: for every attack + keep vector,
// the web boundary and the executed native document must agree (both drop, or
// both preserve). Catches drift — the "parity != coverage" lesson from F1.
import { JSDOM } from "jsdom";
import { sanitizeFragment } from "@/reader/sanitize";
import { buildTopicHtml } from "@/components/contentHtml";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";
import type { GeneratedTopic } from "@/types/book";

const topicWith = (h: string) =>
  ({ id: "t", label: "x", detail: "d", lesson: { title: "x", sections: [{ heading: "S", body_markdown: `i\n\n${h}` }] } } as unknown as GeneratedTopic);
const nativeRoot = (h: string) => {
  const doc = buildTopicHtml(topicWith(h)).replace(/<script src="https:[^"]*"[^>]*><\/script>/g, "");
  return new JSDOM(doc, { runScripts: "dangerously" }).window.document.getElementById("root")?.innerHTML ?? "";
};

it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))("both surfaces drop: %s", (_n, v) => {
  expect(v.leaks(sanitizeFragment(v.html))).toBe(false);
  expect(v.leaks(nativeRoot(v.html))).toBe(false);
});

it.each(KEEP_VECTORS.map((v) => [v.name, v] as const))("both surfaces preserve: %s", (_n, v) => {
  expect(v.survives(sanitizeFragment(v.html))).toBe(true);
  expect(v.survives(nativeRoot(v.html))).toBe(true);
});
