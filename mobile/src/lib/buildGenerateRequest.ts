import { randomUUID } from "@/lib/uuid";
import type { GenerationParams } from "@/types/generationParams";
import type { GenerateRequest } from "@/types/lesson";

interface BuildArgs {
  topic: string;
  apiKey: string;
  params: GenerationParams;
  // Per-lesson page target; overrides params.pages (the batch loop passes the
  // whole-book target divided across topics). Omit to use params.pages.
  targetPages?: number;
  // Persisted per-topic enhancement instructions, applied on (re)generation.
  instructions?: string;
}

// Single source of truth for turning the generation template into a /generate
// request body — replaces the per-screen hardcoded objects so level, depth,
// language, format and page target stay consistent everywhere.
export function buildGenerateRequest({
  topic,
  apiKey,
  params,
  targetPages,
  instructions,
}: BuildArgs): GenerateRequest {
  const pages = targetPages ?? params.pages;
  const trimmed = instructions?.trim();
  return {
    request_id: randomUUID(),
    topic,
    level: params.level,
    language: params.language,
    format: params.format,
    depth: params.depth,
    diagram_register: params.diagramRegister,
    target_pages: pages > 0 ? pages : 0,
    ...(trimmed ? { instructions: trimmed } : {}),
    api_key: apiKey,
  };
}
