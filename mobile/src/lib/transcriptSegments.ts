import type { TranscriptContent, TranscriptSegment } from "@/api/trustClient";

// A segment plus a stable render key. Segment order is otherwise stable, so an
// index-based key is safe across edits (we never insert/remove segments).
export type EditableSegment = TranscriptSegment & { key: string };

export function toEditable(segments: TranscriptSegment[]): EditableSegment[] {
  return segments.map((s, i) => ({ ...s, key: `seg-${i}` }));
}

// Immutable single-segment patch (text and/or speaker — the only editable fields).
export function updateSegment(
  list: EditableSegment[],
  key: string,
  patch: Partial<Pick<TranscriptSegment, "text" | "speaker">>,
): EditableSegment[] {
  return list.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

// Low confidence first, so what needs attention surfaces at the top. Null
// confidence is treated as the lowest (most in need of review). Stable sort:
// ties keep their original order (index tie-break).
export function orderLowConfidenceFirst(list: EditableSegment[]): EditableSegment[] {
  const val = (c: number | null) => (c == null ? -1 : c);
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => val(a.s.confidence) - val(b.s.confidence) || a.i - b.i)
    .map(({ s }) => s);
}

export type ConfidenceTone = "low" | "medium" | "high";

// Segment-level (not per-word — API limit) confidence banding for shading.
export function confidenceTone(confidence: number | null): ConfidenceTone {
  if (confidence == null || confidence < 0.5) return "low";
  if (confidence < 0.8) return "medium";
  return "high";
}

// Build the content object to save: strip the render `key`, keep everything
// non-segment (language, source_audio_ref, stt_meta) from the loaded content.
export function segmentsForSave(edited: EditableSegment[], original: TranscriptContent): TranscriptContent {
  return {
    language: original.language,
    source_audio_ref: original.source_audio_ref,
    stt_meta: original.stt_meta,
    segments: edited.map(({ key, ...seg }) => {
      void key;
      return seg;
    }),
  };
}

// Distinct non-empty speaker names in first-seen order, for quick-assign chips.
export function speakerNames(list: EditableSegment[]): string[] {
  const seen: string[] = [];
  for (const s of list) {
    const name = (s.speaker ?? "").trim();
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}
