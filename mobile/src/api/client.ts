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
import type { TrustManifest } from "@/types/trust";
import { fromBase64 } from "@/storage/pickBookFile";

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

// ── Export: compile a book to a downloadable artifact ─────────────────────────
// Returns the artifact bytes (EPUB or PDF) plus the book-level Content Trust
// Manifest (ADR-015 / SBQ-TRUST-002) when the backend attaches one. Key-free.
// EPUB/PDF run as an async job (submit → poll → download) so a minutes-long
// diagram compile can't 524 behind Cloudflare's ~100s proxy timeout; `cover` is
// a sub-second synchronous call. 422 → the book has no generated content (or is
// malformed); surface via ApiError.body. diagrams=true renders Mermaid→SVG.
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover"; // "cover" → a PNG thumbnail of the cover
  diagrams?: boolean;
  // Called with the async job id right after submit (epub/pdf only), before the
  // compile finishes — lets a caller persist a "generating" status that a list
  // can reconcile later. Not called for the synchronous `cover` path.
  onSubmitted?: (jobId: string) => void;
}

export interface ExportedArtifact {
  artifact: ArrayBuffer;
  // Book-level trust manifest from the X-Content-Trust-Manifest header. Absent
  // for cover exports and for any older backend that doesn't emit it.
  trust?: TrustManifest;
}

// Decode the base64 X-Content-Trust-Manifest header → manifest. Hermes has no
// atob, so go base64 → bytes (fromBase64) → UTF-8 JSON (the latin1→UTF-8 trick
// mirrors BookCover's btoa(unescape(encodeURIComponent(...)))). A malformed
// header never breaks the download — it just yields no badge.
function decodeTrustHeader(b64: string | null | undefined): TrustManifest | undefined {
  if (!b64) return undefined;
  try {
    const bytes = new Uint8Array(fromBase64(b64));
    let latin1 = "";
    for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]);
    return JSON.parse(decodeURIComponent(escape(latin1))) as TrustManifest;
  } catch {
    return undefined;
  }
}

// ── Open Library (ADR-027): publish + reader-visible artifacts ────────────────

// Public per-book artifact metadata (anon-readable). Absent format ⇒ not
// published. Drives reader indicators.
export interface PublishedArtifacts {
  epub?: { size_bytes: number; content_hash: string; published_at: string };
  pdf?: { size_bytes: number; content_hash: string; published_at: string };
}

// Publish a book to the Open Library. Compiles server-side (async, same job
// machinery) and, on done, hosts + registers the artifact for readers. Returns
// the finished job status (`published` true on success). Requires a session token.
export async function publishBook(
  book: Book,
  format: "epub" | "pdf",
  token: string,
  diagrams = true,
): Promise<ExportJobStatus> {
  const params = new URLSearchParams({ format, diagrams: String(diagrams) });
  const res = await fetch(`${BASE_URL}/api/v1/library/${book.id}/publish?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(book),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  const { job_id } = (await res.json()) as { job_id: string };
  return pollExportJob(job_id);
}

// Public: what a given book has published (readers see this without an account).
export async function getPublishedArtifacts(bookId: string): Promise<PublishedArtifacts> {
  return apiFetch<PublishedArtifacts>(`/library/${bookId}/artifacts`);
}

// The status a poll of an async export job can be in.
export interface ExportJobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  title?: string;
  filename?: string;
  format?: string;
  size?: number;
  warnings?: number;
  trust?: string; // base64 Content Trust Manifest
}

// A diagram-heavy book compiles for minutes on the backend (one headless-Chromium
// pass per Mermaid block); this bounds the total wait, while each poll is a cheap
// GET. Matches the backend's export_diagram_timeout ceiling.
const EXPORT_POLL_TIMEOUT_MS = 1_200_000; // 20 min

async function submitExportJob(
  book: Book,
  format: "epub" | "pdf",
  diagrams: boolean,
): Promise<string> {
  const params = new URLSearchParams({ format, diagrams: String(diagrams) });
  const res = await fetch(`${BASE_URL}/api/v1/export/jobs?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}

// One-shot status read for an export job — used to reconcile a `generating`
// indicator after the author navigated away from the export screen.
export async function getExportJob(jobId: string): Promise<ExportJobStatus> {
  return apiFetch<ExportJobStatus>(`/export/jobs/${jobId}`);
}

async function pollExportJob(
  jobId: string,
  intervalMs = POLL_INTERVAL_MS,
): Promise<ExportJobStatus> {
  const deadline = Date.now() + EXPORT_POLL_TIMEOUT_MS;
  return new Promise<ExportJobStatus>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for the export"));
        return;
      }
      try {
        const job = await apiFetch<ExportJobStatus>(`/export/jobs/${jobId}`);
        if (job.status === "done" || job.status === "failed") resolve(job);
        else setTimeout(tick, intervalMs);
      } catch (err) {
        reject(err);
      }
    };
    void tick();
  });
}

async function fetchExportArtifact(jobId: string): Promise<ExportedArtifact> {
  const res = await fetch(`${BASE_URL}/api/v1/export/jobs/${jobId}/artifact`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  const trust = decodeTrustHeader(res.headers?.get("X-Content-Trust-Manifest"));
  return { artifact: await res.arrayBuffer(), trust };
}

// The cover thumbnail is sub-second, so it stays on the synchronous /export
// endpoint — an async job would just add polling latency for no benefit.
async function exportCoverSync(book: Book): Promise<ExportedArtifact> {
  const res = await fetch(`${BASE_URL}/api/v1/export?format=cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  const trust = decodeTrustHeader(res.headers?.get("X-Content-Trust-Manifest"));
  return { artifact: await res.arrayBuffer(), trust };
}

// Compile a book to a downloadable artifact.
//
// EPUB/PDF compile can take minutes (diagram rendering), which is longer than
// Cloudflare's ~100s proxy timeout — a synchronous request would 524. So those
// run as an async job: submit → poll status → download the artifact, each call
// well under the proxy limit. `cover` stays synchronous (sub-second). The return
// shape is unchanged, so callers don't care which path ran.
export async function exportBook(book: Book, opts: ExportOptions = {}): Promise<ExportedArtifact> {
  const format = opts.format ?? "epub";
  if (format === "cover") return exportCoverSync(book);

  const jobId = await submitExportJob(book, format, opts.diagrams ?? false);
  opts.onSubmitted?.(jobId);
  const job = await pollExportJob(jobId);
  if (job.status === "failed") {
    throw new Error(job.error || "The export could not be completed.");
  }
  return fetchExportArtifact(jobId);
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
