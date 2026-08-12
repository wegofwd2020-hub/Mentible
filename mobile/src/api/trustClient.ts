import { ApiError, resolveBaseUrl } from "./client";

export interface MembershipView { project_id: string; role: string }
export interface SessionSyncView { account_id: string; email: string | null; memberships: MembershipView[] }
export interface StructuredTocUnit {
  id: string; title: string; subtopics: unknown[]; prerequisites: string[]; source_ids?: string[];
}
export interface StructuredTocSubject { subject_label: string; units: StructuredTocUnit[] }
export interface StructuredTocView { subjects: StructuredTocSubject[] }
export interface ProjectView {
  id: string; title: string; topic: string | null; audience: string | null;
  goal: string | null; status: string; created_at: string | null;
  toc?: StructuredTocView;
}
export interface ArtifactView {
  id: string; project_id: string; role: string; format: string; title: string | null; created_at: string | null;
}
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }
export interface DraftSection { heading: string; body: string; source_ids: string[] }
export interface FeedbackView {
  id: string; version_id: string; author_kind: string; author_name: string | null;
  body: string; created_at: string | null;
}
export interface VersionDetailView {
  id: string; artifact_id: string; version_no: number;
  content: { sections: DraftSection[] };
  generation_meta: Record<string, unknown> | null;
  is_validated: boolean; recorded_via: string | null; created_at: string | null;
  feedback: FeedbackView[];
}
export interface ArtifactDetailView { artifact: ArtifactView; versions: VersionSummaryView[] }
export interface ProjectInputView {
  id: string; kind: string; title: string | null;
  content: string; source_ref: string | null; created_at: string | null;
}
export interface TopicStatusView {
  topic_id: string; status: "not_generated" | "drafted" | "validated";
  latest_version_id?: string | null; version_no?: number | null;
}
export interface ProjectDetailView {
  project: ProjectView; artifacts: ArtifactDetailView[]; inputs: ProjectInputView[]; my_role: string;
  topic_status?: TopicStatusView[]; book_validated?: boolean;
}
export interface ApprovalView {
  id: string; version_id: string; expert_name: string; approved_at: string; recorded_via: string;
  action?: string; // "approve" | "withdraw" — present since the approve/unapprove toggle
}
export interface TopicApprovalView {
  id: string; topic_version_id: string; expert_name: string; approved_at: string; recorded_via: string | null;
  action?: string; // "approve" | "withdraw"
}
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null }
export interface InvitationView { project_id: string; invited_email: string; role: string; revoked_at: string | null }
export interface VersionCreatedView { id: string; artifact_id: string; version_no: number; created_at: string | null }
export interface TopicVersionCreatedView { id: string; topic_id: string; version_no: number; created_at: string | null }
export interface TopicFeedbackView {
  id: string; author_kind: string; author_name: string | null;
  body: string; created_at: string | null;
}
export interface TopicVersionDetailView {
  id: string; topic_id: string; title: string;
  content: { sections: DraftSection[] };
  version_no: number; created_at: string | null;
  is_validated: boolean; recorded_via: string | null;
  generation_meta: Record<string, unknown> | null;
  feedback: TopicFeedbackView[];
}
export interface TopicVersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean }

// Phase A async per-topic generate (T2): POST .../generate now returns 202 +
// this job handle immediately; the actual generation runs in a Celery worker.
export interface TopicGenerateJobOut { job_id: string; status: string }
// The job's eventual persisted result, once `status` is "done" — polled from
// the SAME shared GET /api/v1/jobs/{id} endpoint /generate uses (see
// backend/src/trust/router.py's generate_topic docstring).
export interface TopicGenerateJobResult { version_id: string; topic_id: string; version_no: number }
export interface TopicGenerateJobStatusView {
  status: "queued" | "running" | "done" | "failed";
  result?: TopicGenerateJobResult;
  error?: string;
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
  return (await trustFetch<ProjectDetailView>(`/projects/${projectId}`, token, { method: "GET" })) as ProjectDetailView;
}

export async function getVersion(versionId: string, token: string): Promise<VersionDetailView> {
  return (await trustFetch<VersionDetailView>(`/versions/${versionId}`, token, { method: "GET" })) as VersionDetailView;
}

export async function approveVersion(
  versionId: string, body: { approved_at: string; note?: string; expert_name?: string }, token: string,
): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(
    `/versions/${versionId}/approvals`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ApprovalView;
}

export async function withdrawApproval(
  versionId: string, body: { note?: string }, token: string,
): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(
    `/versions/${versionId}/approvals/withdraw`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ApprovalView;
}

export async function addFeedback(
  versionId: string, body: { body: string }, token: string,
): Promise<FeedbackView> {
  return (await trustFetch<FeedbackView>(
    `/versions/${versionId}/feedback`, token, { method: "POST", body: JSON.stringify(body) },
  )) as FeedbackView;
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

// Phase C async whole-book/whole-artifact generate (T1/T2): POST
// .../versions/generate now returns 202 + this job handle immediately; the
// actual generation runs in a Celery worker. Poll `getGenerateVersionJob`
// below (or use `useGenerateVersionJob`) for the eventual `done`/`failed`
// result, off the SAME shared GET /api/v1/jobs/{id} endpoint /generate, the
// per-topic generate, and suggest-toc jobs also use.
export interface VersionGenerateJobOut { job_id: string; status: string }
export interface GenerateVersionJobResult { version_id: string; artifact_id: string; version_no: number }
export interface GenerateVersionJobStatusView {
  status: "queued" | "running" | "done" | "failed";
  result?: GenerateVersionJobResult;
  error?: string;
}

export async function generateVersion(
  artifactId: string, body: { api_key: string; provider_id?: string; model?: string; guidance?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/artifacts/${artifactId}/versions/generate`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

// Polls the SHARED (non-/trust-prefixed) GET /api/v1/jobs/{id} endpoint that
// /generate, /structure, suggest-toc, and the per-topic generate job also
// use. Same fetch/ApiError shape as `getJob`/`getSuggestTocJob`.
export async function getGenerateVersionJob(jobId: string, token: string): Promise<GenerateVersionJobStatusView> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<GenerateVersionJobStatusView>;
}

export async function invite(projectId: string, email: string, token: string): Promise<InvitationView> {
  return (await trustFetch<InvitationView>(`/projects/${projectId}/invitations`, token, { method: "POST", body: JSON.stringify({ email }) })) as InvitationView;
}

export async function addProjectInput(
  projectId: string,
  body: { kind: "transcript" | "note" | "link"; title?: string; content: string; source_ref?: string },
  token: string,
): Promise<ProjectInputView> {
  return (await trustFetch<ProjectInputView>(
    `/projects/${projectId}/inputs`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ProjectInputView;
}

export async function updateInput(
  inputId: string, body: { title?: string; content?: string; source_ref?: string }, token: string,
): Promise<ProjectInputView> {
  return (await trustFetch<ProjectInputView>(`/inputs/${inputId}`, token, { method: "PATCH", body: JSON.stringify(body) })) as ProjectInputView;
}

export async function deleteInput(inputId: string, token: string): Promise<void> {
  await trustFetch<null>(`/inputs/${inputId}`, token, { method: "DELETE" });
}

// Phase B async suggest-TOC (T1/T2): POST .../suggest-toc now returns 202 +
// this job handle immediately; the actual outline generation runs in a
// Celery worker. Poll `getSuggestTocJob` below (or use `useSuggestTocJob`)
// for the eventual `done`/`failed` result.
export interface TocSuggestJobOut { job_id: string; status: string }
export interface SuggestTocJobStatusView {
  status: "queued" | "running" | "done" | "failed";
  result?: { toc: StructuredTocView };
  error?: string;
}

export async function suggestToc(
  projectId: string, body: { api_key: string; provider_id?: string }, token: string,
): Promise<TocSuggestJobOut> {
  return (await trustFetch<TocSuggestJobOut>(
    `/projects/${projectId}/suggest-toc`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TocSuggestJobOut;
}

// Polls the SHARED (non-/trust-prefixed) GET /api/v1/jobs/{id} endpoint that
// /generate, /structure, and the per-topic generate job also use (see
// getJob below). Same fetch/ApiError shape.
export async function getSuggestTocJob(jobId: string, token: string): Promise<SuggestTocJobStatusView> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<SuggestTocJobStatusView>;
}

export async function saveToc(projectId: string, toc: StructuredTocView, token: string): Promise<void> {
  await trustFetch(`/projects/${projectId}/toc`, token, { method: "PUT", body: JSON.stringify({ toc }) });
}

// Submits a per-topic generate as an async job (Phase A / T2) — the backend
// returns 202 + {job_id, status:"queued"} immediately; poll `getJob` below
// for the eventual `done`/`failed` result. Callers wanting a single
// submit-then-poll promise should use `useGenerateTopicJob` rather than
// polling this directly.
export async function generateTopic(
  projectId: string, topicId: string, body: { api_key: string; provider_id?: string; model?: string; guidance?: string }, token: string,
): Promise<TopicGenerateJobOut> {
  return (await trustFetch<TopicGenerateJobOut>(
    `/projects/${projectId}/topics/${topicId}/generate`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TopicGenerateJobOut;
}

// Polls the SHARED (non-/trust-prefixed) GET /api/v1/jobs/{id} endpoint that
// /generate and /structure also use (backend/src/generate/router.py). The
// route itself needs no auth (it only reads a Redis-backed status row keyed
// by job_id, not a project), but `token` is accepted for API-shape
// consistency with the rest of trustClient and sent as a harmless bearer.
export async function getJob(jobId: string, token: string): Promise<TopicGenerateJobStatusView> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<TopicGenerateJobStatusView>;
}

export async function getTopicVersion(id: string, token: string): Promise<TopicVersionDetailView> {
  return (await trustFetch<TopicVersionDetailView>(`/topic-versions/${id}`, token, { method: "GET" })) as TopicVersionDetailView;
}

export async function recordTopicApproval(
  id: string, body: { approved_at: string; note?: string; expert_name?: string }, token: string,
): Promise<TopicApprovalView> {
  return (await trustFetch<TopicApprovalView>(
    `/topic-versions/${id}/approvals`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TopicApprovalView;
}

export async function withdrawTopicApproval(
  id: string, body: { note?: string }, token: string,
): Promise<TopicApprovalView> {
  return (await trustFetch<TopicApprovalView>(
    `/topic-versions/${id}/approvals/withdraw`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TopicApprovalView;
}

export async function addTopicFeedback(
  topicVersionId: string, body: { body: string }, token: string,
): Promise<TopicFeedbackView> {
  return (await trustFetch<TopicFeedbackView>(
    `/topic-versions/${topicVersionId}/feedback`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TopicFeedbackView;
}

export async function getTopicVersions(
  projectId: string, topicId: string, token: string,
): Promise<TopicVersionSummaryView[]> {
  return (await trustFetch<TopicVersionSummaryView[]>(
    `/projects/${projectId}/topics/${topicId}/versions`, token, { method: "GET" },
  )) as TopicVersionSummaryView[];
}

export async function createTopicVersion(
  projectId: string, topicId: string, content: object, token: string,
): Promise<TopicVersionCreatedView> {
  return (await trustFetch<TopicVersionCreatedView>(
    `/projects/${projectId}/topics/${topicId}/versions`, token, { method: "POST", body: JSON.stringify({ content }) },
  )) as TopicVersionCreatedView;
}
