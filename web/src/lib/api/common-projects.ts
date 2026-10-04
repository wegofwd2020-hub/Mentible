import { ProjectView, StructuredTocView } from "./types";

export interface CommonProjectSummary {
  id: string;
  author_name: string;
  title: string;
  description: string | null;
  tags?: string[];
  created_at: string;
  updated_at: string;
  is_author: boolean;
}

export interface CommonProjectDetail extends CommonProjectSummary {
  project_data: {
    toc?: StructuredTocView;
    [key: string]: unknown;
  };
  taken_down_at?: string | null;
  taken_down_reason?: string | null;
}

// API returns array directly, wrapper for pagination state
export interface CommonProjectsListResponse {
  projects: CommonProjectSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportConflictResolution {
  action: "keep_existing" | "keep_new" | "new_with_suffix";
  new_title?: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Expo export --platform web sets EXPO_PUBLIC_* as window globals
const API_BASE = typeof window !== 'undefined' && (window as any).EXPO_PUBLIC_API_BASE_URL
  ? (window as any).EXPO_PUBLIC_API_BASE_URL
  : "https://mambakkam.net/mentible-api";

async function trustFetch<T>(
  path: string,
  options?: RequestInit & { token?: string; allowOptionalAuth?: boolean },
): Promise<T> {
  const { token, allowOptionalAuth, ...fetchOptions } = options || {};

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

export async function listCommonProjects(
  opts?: {
    q?: string;
    tag?: string | string[];
    limit?: number;
    offset?: number;
    token?: string;
  },
): Promise<CommonProjectsListResponse> {
  const params = new URLSearchParams();
  if (opts?.q) params.append("q", opts.q);
  if (opts?.tag) {
    const tags = Array.isArray(opts.tag) ? opts.tag : [opts.tag];
    tags.forEach((t) => params.append("tag", t));
  }
  if (opts?.limit) params.append("limit", String(opts.limit));
  if (opts?.offset) params.append("offset", String(opts.offset));

  const qs = params.toString();
  const path = `/common-projects${qs ? `?${qs}` : ""}`;

  // Backend returns array directly
  const projects = await trustFetch<CommonProjectSummary[]>(path, {
    method: "GET",
    token: opts?.token,
    allowOptionalAuth: true,
  });

  // Wrap for pagination state
  return {
    projects: projects || [],
    total: projects?.length || 0,
    limit: opts?.limit || 20,
    offset: opts?.offset || 0,
  };
}

export async function getCommonProject(
  projectId: string,
  token?: string,
): Promise<CommonProjectDetail> {
  return trustFetch<CommonProjectDetail>(
    `/common-projects/${encodeURIComponent(projectId)}`,
    {
      method: "GET",
      token,
      allowOptionalAuth: true,
    },
  );
}

export async function publishCommonProject(
  body: {
    title: string;
    description?: string;
    tags?: string[];
    project_data: Record<string, unknown>;
  },
  token: string,
): Promise<CommonProjectDetail> {
  return trustFetch<CommonProjectDetail>("/common-projects", {
    method: "POST",
    body: JSON.stringify(body),
    token,
  });
}

export async function updateCommonProject(
  projectId: string,
  body: {
    title: string;
    description?: string;
    tags?: string[];
    project_data: Record<string, unknown>;
  },
  token: string,
): Promise<CommonProjectDetail> {
  return trustFetch<CommonProjectDetail>(
    `/common-projects/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    },
  );
}

export async function deleteCommonProject(
  projectId: string,
  token: string,
): Promise<void> {
  await trustFetch<null>(`/common-projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    token,
  });
}

export async function importCommonProject(
  projectId: string,
  token: string,
  opts?: { conflict_action?: string; new_title?: string },
): Promise<ProjectView> {
  return trustFetch<ProjectView>(
    `/common-projects/${encodeURIComponent(projectId)}/import`,
    {
      method: "POST",
      body: opts ? JSON.stringify(opts) : undefined,
      token,
    },
  );
}

// Admin fetch helper for /api/v1/admin endpoints
async function adminFetch<T>(
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

  const res = await fetch(`${API_BASE}/api/v1/admin${path}`, {
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

export interface AdminCommonProjectRow {
  id: string;
  title: string;
  description: string | null;
  author_name: string;
  created_at: string;
  updated_at: string;
  taken_down_at: string | null;
  taken_down_reason: string | null;
}

export interface AdminCommonProjectsList {
  projects: AdminCommonProjectRow[];
  total: number;
  limit: number;
  offset: number;
}

// Admin endpoints — super-admin only
export async function adminListCommonProjects(
  opts?: {
    q?: string;
    limit?: number;
    offset?: number;
    token?: string;
  },
): Promise<AdminCommonProjectsList> {
  const params = new URLSearchParams();
  if (opts?.q) params.append("q", opts.q);
  if (opts?.limit) params.append("limit", String(opts.limit));
  if (opts?.offset) params.append("offset", String(opts.offset));

  const qs = params.toString();
  const path = `/common-projects${qs ? `?${qs}` : ""}`;

  return adminFetch<AdminCommonProjectsList>(path, {
    method: "GET",
    token: opts?.token,
  });
}

export async function takeDownCommonProject(
  projectId: string,
  body: { reason: string },
  token: string,
): Promise<{ id: string; taken_down_at: string; taken_down_reason: string; message: string }> {
  return adminFetch(
    `/common-projects/${encodeURIComponent(projectId)}/takedown`,
    {
      method: "POST",
      body: JSON.stringify(body),
      token,
    },
  );
}

export async function restoreCommonProject(
  projectId: string,
  token: string,
): Promise<{ id: string; taken_down_at: null; taken_down_reason: null; message: string }> {
  return adminFetch(
    `/common-projects/${encodeURIComponent(projectId)}/restore`,
    {
      method: "POST",
      token,
    },
  );
}

export { ApiError };
