import {
  toEditable,
  updateSegment,
  orderLowConfidenceFirst,
  confidenceTone,
  segmentsForSave,
  speakerNames,
} from "@/lib/transcriptSegments";
import type { TranscriptContent, TranscriptSegment } from "@/api/trustClient";

const seg = (over: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  text: "x",
  start: 0,
  end: 1,
  confidence: 0.9,
  speaker: null,
  ...over,
});

describe("transcriptSegments", () => {
  it("toEditable assigns stable keys by index", () => {
    const list = toEditable([seg({ text: "a" }), seg({ text: "b" })]);
    expect(list.map((s) => s.key)).toEqual(["seg-0", "seg-1"]);
  });

  it("updateSegment changes only the matching key, immutably", () => {
    const list = toEditable([seg({ text: "a" }), seg({ text: "b" })]);
    const next = updateSegment(list, "seg-1", { text: "B", speaker: "Guest" });
    expect(next).not.toBe(list);
    expect(next[0].text).toBe("a");
    expect(next[1]).toMatchObject({ text: "B", speaker: "Guest" });
    expect(list[1].text).toBe("b"); // original untouched
  });

  it("orderLowConfidenceFirst puts real low numbers first; null (unknown) sorts last, stable", () => {
    const list = toEditable([
      seg({ text: "high", confidence: 0.95 }),
      seg({ text: "null", confidence: null }),
      seg({ text: "low", confidence: 0.2 }),
      seg({ text: "high2", confidence: 0.95 }),
    ]);
    // low number first; high before the confidence-less "null" (unknown, not low).
    expect(orderLowConfidenceFirst(list).map((s) => s.text)).toEqual(["low", "high", "high2", "null"]);
  });

  it("all-null (Sarvam) keeps original order — nothing surfaced as low", () => {
    const list = toEditable([seg({ text: "a", confidence: null }), seg({ text: "b", confidence: null })]);
    expect(orderLowConfidenceFirst(list).map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("confidenceTone boundaries", () => {
    expect(confidenceTone(0.49)).toBe("low");
    expect(confidenceTone(0.5)).toBe("medium");
    expect(confidenceTone(0.79)).toBe("medium");
    expect(confidenceTone(0.8)).toBe("high");
    expect(confidenceTone(null)).toBe("unknown");
  });

  it("segmentsForSave strips key and preserves language/source_audio_ref/stt_meta", () => {
    const original: TranscriptContent = {
      language: "ta",
      segments: [seg()],
      source_audio_ref: "input-1",
      stt_meta: { provider: "groq", model: "whisper-large-v3" },
    };
    const edited = updateSegment(toEditable(original.segments), "seg-0", { text: "fixed" });
    const out = segmentsForSave(edited, original);
    expect(out.language).toBe("ta");
    expect(out.source_audio_ref).toBe("input-1");
    expect(out.stt_meta).toEqual({ provider: "groq", model: "whisper-large-v3" });
    expect(out.segments[0].text).toBe("fixed");
    expect((out.segments[0] as unknown as { key?: string }).key).toBeUndefined();
  });

  it("speakerNames dedupes non-empty in first-seen order", () => {
    const list = toEditable([
      seg({ speaker: "Host" }),
      seg({ speaker: null }),
      seg({ speaker: "Guest" }),
      seg({ speaker: "Host" }),
      seg({ speaker: "" }),
    ]);
    expect(speakerNames(list)).toEqual(["Host", "Guest"]);
  });
});
