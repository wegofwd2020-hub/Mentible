/** @jest-environment jsdom */
import { sanitizeFragment } from "@/reader/sanitize";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";

describe("topic web sanitizer — sanitizeFragment", () => {
  it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))(
    "drops the fetch channel: %s",
    (_n, v) => {
      const out = sanitizeFragment(v.html);
      expect(v.leaks(out)).toBe(false);
    },
  );

  it.each(KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "preserves legit content: %s",
    (_n, v) => {
      const out = sanitizeFragment(v.html);
      expect(v.survives(out)).toBe(true);
    },
  );
});
