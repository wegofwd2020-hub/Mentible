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
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }
export interface ArtifactDetailView { artifact: ArtifactView; versions: VersionSummaryView[] }
export interface ProjectDetailView { project: ProjectView; artifacts: ArtifactDetailView[]; my_role: string }
export interface ApprovalView {
  id: string; version_id: string; expert_name: string; approved_at: string; recorded_via: string;
}
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null }
export interface InvitationView { project_id: string; invited_email: string; role: string; revoked_at: string | null }
export interface VersionCreatedView { id: string; artifact_id: string; version_no: number; created_at: string | null }

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
  return (await trustFetch<ProjectDetailView>(`/projects/${projectId}`, token, { method: "GET" })) as ProjectDetailView;
}

export async function approveVersion(
  versionId: string, body: { approved_at: string; note?: string }, token: string,
): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(
    `/versions/${versionId}/approvals`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ApprovalView;
}

export async function listOwnedProjects(token: string): Promise<ProjectSummaryView[]> {
  return (await trustFetch<ProjectSummaryView[]>("/projects", token, { method: "GET" })) as ProjectSummaryView[];
}

export async function createProject(
  body: { title: string; topic?: string; audience?: string; goal?: string }, token: string,
): Promise<ProjectView> {
  return (await trustFetch<ProjectView>("/projects", token, { method: "POST", body: JSON.stringify(body) })) as ProjectView;
}

export async function createArtifact(
  projectId: string, body: { role: string; format: string; title?: string }, token: string,
): Promise<ArtifactView> {
  return (await trustFetch<ArtifactView>(`/projects/${projectId}/artifacts`, token, { method: "POST", body: JSON.stringify(body) })) as ArtifactView;
}

export async function createVersion(
  artifactId: string, body: { content: object; generation_meta?: object }, token: string,
): Promise<VersionCreatedView> {
  return (await trustFetch<VersionCreatedView>(`/artifacts/${artifactId}/versions`, token, { method: "POST", body: JSON.stringify(body) })) as VersionCreatedView;
}

export async function invite(projectId: string, email: string, token: string): Promise<InvitationView> {
  return (await trustFetch<InvitationView>(`/projects/${projectId}/invitations`, token, { method: "POST", body: JSON.stringify({ email }) })) as InvitationView;
}
