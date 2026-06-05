import { buildGenerateRequest } from "@/lib/buildGenerateRequest";
import type { GenerationParams } from "@/types/generationParams";

const PARAMS: GenerationParams = {
  level: "expert",
  depth: "deep",
  pages: 12,
  language: "en",
  format: "lesson",
  diagramRegister: "technical",
};

describe("buildGenerateRequest", () => {
  it("maps the template into the request fields", () => {
    const r = buildGenerateRequest({ topic: "T", apiKey: "k", params: PARAMS });
    expect(r).toMatchObject({
      topic: "T",
      level: "expert",
      depth: "deep",
      language: "en",
      format: "lesson",
      diagram_register: "technical",
      target_pages: 12,
      api_key: "k",
    });
    expect(typeof r.request_id).toBe("string");
    expect(r.instructions).toBeUndefined();
  });

  it("targetPages overrides params.pages", () => {
    const r = buildGenerateRequest({ topic: "T", apiKey: "k", params: PARAMS, targetPages: 3 });
    expect(r.target_pages).toBe(3);
  });

  it("includes trimmed instructions only when non-empty", () => {
    expect(
      buildGenerateRequest({ topic: "T", apiKey: "k", params: PARAMS, instructions: "  add a diagram  " })
        .instructions,
    ).toBe("add a diagram");
    expect(
      buildGenerateRequest({ topic: "T", apiKey: "k", params: PARAMS, instructions: "   " }).instructions,
    ).toBeUndefined();
  });

  it("treats no page target as 0", () => {
    const r = buildGenerateRequest({ topic: "T", apiKey: "k", params: { ...PARAMS, pages: 0 } });
    expect(r.target_pages).toBe(0);
  });
});
