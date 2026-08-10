// Human-readable provenance for a draft version, from its generation_meta.
// Defensive: older/null/oddly-typed metas must never throw.
export function describeProvenance(meta: Record<string, unknown> | null | undefined): string {
  const ids = meta?.["source_input_ids"];
  const n = Array.isArray(ids) ? ids.length : 0;
  const base = n > 0 ? `Generated from ${n} source${n === 1 ? "" : "s"}` : "Generated draft";
  const guidance = meta?.["guidance"];
  const hasGuidance = typeof guidance === "string" && guidance.trim().length > 0;
  return hasGuidance ? `${base} · with your guidance` : base;
}
