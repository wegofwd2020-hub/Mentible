import { Platform } from "react-native";
import type {
  GenerateRequest,
  GenerateResponse,
  JobResponse,
} from "@/types/lesson";

// On web (Expo browser preview), 10.0.2.2 is the Android emulator loopback
// address — unreachable from a real browser. Transparently swap it for
// localhost so the web preview works without touching .env.local.
function resolveBaseUrl(): string {
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
