import { Platform } from "react-native";
import type {
  GenerateRequest,
  GenerateResponse,
  JobResponse,
  Provenance,
} from "@/types/lesson";
import type {
  Book,
  StructureRequest,
  StructureResponse,
  StructureJobResponse,
} from "@/types/book";

// On web (Expo browser preview), 10.0.2.2 is the Android emulator loopback
// address — unreachable from a real browser. Transparently swap it for
// localhost so the web preview works without touching .env.local.
export function resolveBaseUrl(): string {
  const url =
    process.env["EXPO_PUBLIC_API_BASE_URL"] ??
    (Platform.OS === "web" ? "http://localhost:8001" : "http://10.0.2.2:8001");
  if (Platform.OS === "web") return url.replace("10.0.2.2", "localhost");
  return url;
}
const BASE_URL = resolveBaseUrl();

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

export async function submitGenerate(
  req: GenerateRequest,
): Promise<GenerateResponse> {
  return apiFetch<GenerateResponse>("/generate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getJobStatus(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/jobs/${jobId}`);
}

// Current resolved provenance for a book's LLM config — the pin-or-default model
// + version axes — for client-side staleness diffing (ADR-016 D7). Pass the
// book's generationParams.model so `model` reflects the pin; null = default.
// Key-free public metadata.
export async function getCurrentProvenance(
  providerId: string,
  model: string | null,
): Promise<Provenance> {
  const q = new URLSearchParams({ provider: providerId });
  if (model) q.set("model", model);
  return apiFetch<Provenance>(`/registry/current?${q.toString()}`);
}

// ── Book authoring: POST /structure ───────────────────────────────────────────
// Submit a free-text TOC for structuring. Polls the SAME /jobs/{id} endpoint as
// /generate (a structure job's result is a StructuredTOC, not a lesson).

export async function submitStructure(
  req: StructureRequest,
): Promise<StructureResponse> {
  return apiFetch<StructureResponse>("/structure", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getStructureJob(
  jobId: string,
): Promise<StructureJobResponse> {
  return apiFetch<StructureJobResponse>(`/jobs/${jobId}`);
}

// ── Export: POST /export → compile a book to an artifact ──────────────────────
// Returns the raw bytes (EPUB or PDF). Synchronous and key-free. 422 → the book
// has no generated content (or is malformed); surface via ApiError.body.
// diagrams=true renders Mermaid→SVG (much slower — minutes for a big book).
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover"; // "cover" → a PNG thumbnail of the cover
  diagrams?: boolean;
}

export async function exportBook(book: Book, opts: ExportOptions = {}): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    format: opts.format ?? "epub",
    diagrams: String(opts.diagrams ?? false),
  });
  const res = await fetch(`${BASE_URL}/api/v1/export?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.arrayBuffer();
}

export async function pollUntilDone(
  jobId: string,
  onTick?: (job: JobResponse) => void,
  intervalMs = POLL_INTERVAL_MS,
): Promise<JobResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  return new Promise<JobResponse>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for generation"));
        return;
      }
      try {
        const job = await getJobStatus(jobId);
        onTick?.(job);
        if (job.status === "done" || job.status === "failed") {
          resolve(job);
        } else {
          setTimeout(tick, intervalMs);
        }
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}
