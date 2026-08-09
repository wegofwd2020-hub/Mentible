// Studio P3 T3: the native WebView reader document is now a function of the
// ACTIVE palette, not a static string built from the retired `colors` (indigo
// "study") palette. This pins the three theme-reactive facts: the embedded
// Playfair face is present (PLAYFAIR_FONTFACE, T2), the emitted `--bg` var
// tracks whichever palette was passed in (readerVars, T1), and the equation-
// image filter is gated per theme (invert on dark, none on light) rather than
// hardcoded.
import { buildTopicHtml } from "@/components/contentHtml";
import { studioDarkColors, studioLightColors } from "@/constants/theme";
import type { GeneratedTopic } from "@/types/book";

const topic: GeneratedTopic = {
  topicId: "t",
  title: "T",
  generatedAt: "",
  lesson: {
    topic: "T",
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections: [{ heading: "H", body_markdown: "x" }],
    key_takeaways: [],
    further_reading: [],
  },
};

it("embeds themed vars + Playfair, gating the equation filter per theme", () => {
  const dark = buildTopicHtml(topic, undefined, studioDarkColors);
  expect(dark).toContain("Playfair Display"); // PLAYFAIR_FONTFACE injected
  expect(dark).toContain(`--bg: ${studioDarkColors.background}`);
  expect(dark).toContain("--eq-filter: invert(1)");

  const light = buildTopicHtml(topic, undefined, studioLightColors);
  expect(light).toContain(`--bg: ${studioLightColors.background}`);
  expect(light).toContain("--eq-filter: none");
});

it("gates the equation mix-blend-mode per theme (screen erases black glyphs on light paper)", () => {
  // mix-blend-mode: screen was previously hardcoded alongside the gated
  // --eq-filter; on the light/paper theme that erases equation glyphs even
  // though --eq-filter correctly leaves the PNG unfiltered. --eq-blend must
  // be gated exactly like --eq-filter ("never erase math on paper").
  const dark = buildTopicHtml(topic, undefined, studioDarkColors);
  expect(dark).toContain("--eq-blend: screen");

  const light = buildTopicHtml(topic, undefined, studioLightColors);
  expect(light).toContain("--eq-blend: normal");
});
