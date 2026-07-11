// Browser-side harness for the Mermaid-XSS security regression test.
//
// Removing the reader's iframe removed its origin boundary, so a hostile ```mermaid
// source that survived Mermaid's own sanitizer would run with access to the app's
// localStorage (Supabase session + BYOK LLM key). Mermaid renders its `<svg>` AFTER
// our one DOMPurify pass, into the live DOM, so `sanitize.ts` never inspects it —
// safety rests entirely on Mermaid's internal DOMPurify under `securityLevel:"strict"`
// (enhance.ts). This harness drives the REAL pipeline over hostile diagram sources so
// a Mermaid upgrade that weakens "strict" is caught. See the sanitize-boundary notes
// in docs/superpowers and `enhance.ts`.
//
// jsdom cannot host this: Mermaid measures SVG layout (getBBox), which jsdom lacks, so
// `mermaid.run()` never settles. The runner drives real headless Chrome instead.
//
// This mirrors NativeTopicReader.web.tsx exactly: renderTopicToSafeHtml → innerHTML
// (dangerouslySetInnerHTML) → renderDiagrams (the lazy Mermaid post-pass).
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { renderDiagrams } from "@/reader/enhance";
import type { GeneratedTopic } from "@/types/book";

export interface PayloadResult {
  ran: boolean;
  error: string | null;
  /** Proof-of-execution sentinel: a payload that runs pushes its id here. */
  executed: string[];
  /** `onerror=`/`javascript:` left in the rendered SVG string (defence-in-depth check). */
  onerrorInHtml: boolean;
  javascriptUrlInHtml: boolean;
  htmlSample: string;
}

declare global {
  interface Window {
    __xssExecuted: string[];
    __runMermaidPayload: (mermaidSource: string, id: string) => Promise<PayloadResult>;
  }
}

window.__xssExecuted = [];

function topicWithMermaid(source: string): GeneratedTopic {
  return {
    lesson: {
      topic: "Security probe",
      synopsis: "s",
      learning_objectives: ["o"],
      key_takeaways: ["k"],
      sections: [{ heading: "Diagram", body_markdown: "```mermaid\n" + source + "\n```" }],
    },
  } as unknown as GeneratedTopic;
}

window.__runMermaidPayload = async (mermaidSource, id) => {
  const host = document.createElement("div");
  host.className = "mentible-reader";
  document.body.appendChild(host);

  // 1. The one and only DOMPurify pass — exactly as the component does it.
  host.innerHTML = renderTopicToSafeHtml(topicWithMermaid(mermaidSource));

  // 2. Mermaid runs after sanitization and writes straight into the live DOM.
  let ran = false;
  let error: string | null = null;
  try {
    ran = await renderDiagrams(host);
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 200);
  }

  // 3. Give any async payload (img onerror, etc.) a turn to fire.
  await new Promise((r) => setTimeout(r, 300));

  const html = host.innerHTML;
  const result: PayloadResult = {
    ran,
    error,
    executed: [...window.__xssExecuted],
    onerrorInHtml: /onerror/i.test(html),
    javascriptUrlInHtml: /javascript:/i.test(html),
    htmlSample: html.slice(0, 300),
  };
  host.remove();
  return result;
};
