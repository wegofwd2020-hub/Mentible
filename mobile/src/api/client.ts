import { Platform } from "react-native";
import { IS_DEMO } from "@/constants/demo";
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
// A multi-page lesson legitimately takes minutes to generate (SCOPE D12: "latency
// target: minutes, not seconds") — observed ~150-170s for a typical topic, but a
// topic that hits the backend's schema-repair retry loop can take ~390s+ (each
// repair is another full model call). 120s/360s gave up before the backend
// finished, surfacing a false "timed out" while the job actually completed and was
// then discarded. 600s absorbs the repair-heavy outliers.
const POLL_TIMEOUT_MS = 600_000;

// Parse a Retry-After header (our backend sends integer seconds). Returns
// undefined for an absent/non-numeric value (we don't handle the HTTP-date form
// since the backend never sends it).
function retryAfterSeconds(res: Response): number | undefined {
  // Optional-chained: a real Response always has headers, but guard so a partial
  // mock or a non-standard error response can't throw past the real failure.
  const raw = res.headers?.get?.("Retry-After");
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

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
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  return res.json() as Promise<T>;
}

// Friendly phrasing for a 429, scaled by how long the caller must wait: a short
// Retry-After is the per-minute burst guard; a long one is the per-day cap.
function rateLimitMessage(retryAfter?: number): string {
  if (retryAfter && retryAfter > 3600) {
    const hours = Math.ceil(retryAfter / 3600);
    return `You’ve reached today’s generation limit. It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  if (retryAfter && retryAfter > 60) {
    const mins = Math.ceil(retryAfter / 60);
    return `You’re generating too fast. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
  }
  if (retryAfter && retryAfter > 0) {
    return `You’re generating too fast. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`;
  }
  return "You’re generating too fast. Please wait a moment and try again.";
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    // Seconds to wait before retrying, from the Retry-After header (429 only).
    public readonly retryAfter?: number,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }

  // A user-facing message. 429 (rate limited) is phrased by wait magnitude;
  // other statuses surface the server's `detail` string, then a generic line.
  userMessage(): string {
    if (this.status === 429) return rateLimitMessage(this.retryAfter);
    try {
      const detail = JSON.parse(this.body)?.detail;
      if (typeof detail === "string") return detail;
    } catch {
      /* body not JSON */
    }
    return "Something went wrong. Please try again.";
  }
}

export async function submitGenerate(
  req: GenerateRequest,
): Promise<GenerateResponse> {
  // Safety net: a demo build has no backend. Callers gate the UI with demoBlocked(),
  // but never let a request leave the device here.
  if (IS_DEMO) throw new Error("Content generation is disabled in this demo build.");
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
  if (IS_DEMO) throw new Error("Authoring is disabled in this demo build.");
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
    throw new ApiError(res.status, body, retryAfterSeconds(res));
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
