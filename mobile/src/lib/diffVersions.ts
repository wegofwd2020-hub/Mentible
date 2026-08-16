export type SectionDiff = { heading: string; status: "added" | "removed" | "changed" | "unchanged" };
type Sec = { heading: string; body: string };

// Match sections by heading (order-independent). Duplicate headings match positionally
// within their same-heading group. Result lists curr's sections in order, then any removed.
export function diffVersions(prev: Sec[], curr: Sec[]): SectionDiff[] {
  const prevByHeading = new Map<string, string[]>();
  for (const s of prev) (prevByHeading.get(s.heading) ?? prevByHeading.set(s.heading, []).get(s.heading)!).push(s.body);
  const consumed = new Map<string, number>();
  const out: SectionDiff[] = [];
  for (const s of curr) {
    const bodies = prevByHeading.get(s.heading);
    const idx = consumed.get(s.heading) ?? 0;
    if (!bodies || idx >= bodies.length) out.push({ heading: s.heading, status: "added" });
    else { out.push({ heading: s.heading, status: bodies[idx] === s.body ? "unchanged" : "changed" }); consumed.set(s.heading, idx + 1); }
  }
  for (const [heading, bodies] of prevByHeading) {
    const used = consumed.get(heading) ?? 0;
    for (let i = used; i < bodies.length; i++) out.push({ heading, status: "removed" });
  }
  return out;
}
