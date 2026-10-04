import { ApiError } from "./common-projects";

// Expo export --platform web sets EXPO_PUBLIC_* as window globals
const API_BASE = typeof window !== 'undefined' && (window as any).EXPO_PUBLIC_API_BASE_URL
  ? (window as any).EXPO_PUBLIC_API_BASE_URL
  : "https://mambakkam.net/mentible-api";

async function trustFetch<T>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<T> {
  const { token, ...fetchOptions } = options || {};

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...fetchOptions.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api/v1/trust${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  created_at: string | null;
  topic: string | null;
  audience: string | null;
  goal: string | null;
}

export interface Membership {
  project_id: string;
  role: "owner" | "reviewer" | "editor";
}

export interface SessionSync {
  memberships: Membership[];
}

export interface TopicStatus {
  topic_id: string;
  topic_name: string | null;
  status: string;
}

export interface VersionSummary {
  id: string;
  version_no: number;
  created_at: string;
  approved_at: string | null;
  is_validated: boolean;
}

export interface ArtifactSummary {
  id: string;
  role: string;
  format: string;
  title: string | null;
  versions: VersionSummary[];
}

export interface ProjectDetail {
  project: {
    id: string;
    title: string;
    topic: string | null;
    audience: string | null;
    goal: string | null;
    status: string;
    created_at: string | null;
    toc: unknown | null;
    rights_attested_at: string | null;
    rights_holder: string | null;
  };
  artifacts: ArtifactSummary[];
  my_role: string;
  inputs: Array<{
    id: string;
    kind: string;
    title: string | null;
    content: string;
    source_ref: string | null;
  }>;
  topic_status: TopicStatus[];
  book_validated: boolean;
}

export async function syncSession(token: string): Promise<SessionSync> {
  return trustFetch<SessionSync>("/session/sync", {
    method: "POST",
    token,
  });
}

export async function listOwnedProjects(token: string): Promise<ProjectSummary[]> {
  return trustFetch<ProjectSummary[]>("/projects", {
    method: "GET",
    token,
  });
}

export async function getProject(projectId: string, token: string): Promise<ProjectDetail> {
  return trustFetch<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "GET",
    token,
  });
}

export async function updateProject(
  projectId: string,
  data: { title?: string; topic?: string; audience?: string; goal?: string },
  token: string,
): Promise<ProjectDetail> {
  return trustFetch<ProjectDetail>(`/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function generateTopics(projectId: string, token: string): Promise<{ job_id: string }> {
  return trustFetch<{ job_id: string }>(`/projects/${encodeURIComponent(projectId)}/generate`, {
    method: "POST",
    token,
  });
}

export async function publishProject(
  data: {
    title: string;
    description?: string;
    tags?: string[];
    project_data: Record<string, unknown>;
  },
  token: string,
): Promise<{ id: string; title: string }> {
  return trustFetch<{ id: string; title: string }>("/common-projects", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export { ApiError };
