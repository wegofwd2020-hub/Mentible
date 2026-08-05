// Serialize a draft version's sections to plain text or Markdown for Publish /
// Copy. Shared by the draft viewer's Copy action and the Publish tab so the two
// stay identical. An empty heading or body is dropped rather than emitting a
// dangling separator; an optional title is prepended (asset title on Publish).
import type { DraftSection } from "@/api/trustClient";

export function sectionsToPlainText(sections: DraftSection[] | undefined, title?: string): string {
  const body = (sections ?? [])
    .map((s) => [s.heading, s.body].map((t) => (t ?? "").trim()).filter(Boolean).join("\n\n"))
    .filter(Boolean)
    .join("\n\n");
  const t = title?.trim();
  return t ? (body ? `${t}\n\n${body}` : t) : body;
}

export function sectionsToMarkdown(sections: DraftSection[] | undefined, title?: string): string {
  const body = (sections ?? [])
    .map((s) => {
      const h = (s.heading ?? "").trim();
      const b = (s.body ?? "").trim();
      return [h ? `## ${h}` : "", b].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
  const t = title?.trim();
  return t ? (body ? `# ${t}\n\n${body}` : `# ${t}`) : body;
}
