import { ApiError, resolveBaseUrl } from "./client";

export interface MembershipView { project_id: string; role: string }
export interface SessionSyncView { account_id: string; email: string | null; memberships: MembershipView[] }
export interface ProjectView {
  id: string; title: string; topic: string | null; audience: string | null;
  goal: string | null; status: string; created_at: string | null;
}
export interface ArtifactView {
  id: string; project_id: string; role: string; format: string; title: string | null; created_at: string | null;
}
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean }
export interface ArtifactDetailView { artifact: ArtifactView; versions: VersionSummaryView[] }
export interface ProjectDetailView { project: ProjectView; artifacts: ArtifactDetailView[]; my_role: string }
export interface ApprovalView {
  id: string; version_id: string; expert_name: string; approved_at: string; recorded_via: string;
}

async function trustFetch<T>(path: string, token: string, options?: RequestInit): Promise<T | null> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/trust${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export async function syncSession(token: string): Promise<SessionSyncView> {
  return (await trustFetch<SessionSyncView>("/session/sync", token, { method: "POST" })) as SessionSyncView;
}

export async function getProject(projectId: string, token: string): Promise<ProjectDetailView> {
  return (await trustFetch<ProjectDetailView>(`/projects/${projectId}`, token)) as ProjectDetailView;
}

export async function approveVersion(
  versionId: string, body: { approved_at: string; note?: string }, token: string,
): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(
    `/versions/${versionId}/approvals`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ApprovalView;
}
