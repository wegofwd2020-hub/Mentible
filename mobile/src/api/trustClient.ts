import { ApiError, resolveBaseUrl } from "./client";
import { buildAudioForm, type PickedAudio } from "@/api/audioUpload";

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
  rights_attested_at: string | null;
  rights_holder: string | null;
}
export interface ArtifactView {
  id: string; project_id: string; role: string; format: string; title: string | null; created_at: string | null;
}
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }
export interface DraftSection { heading: string; body: string; source_ids: string[] }
export interface CoverageReport { sections_total: number; sections_cited: number; uncited_section_indexes: number[]; dangling: { section_index: number; source_id: string }[]; source_refs: number }
export interface Readability { flesch_reading_ease: number; grade_level: number; words: number; sentences: number }
export interface GroundingReport { claims_total: number; supported: number; partial: number; unsupported: number; by_section: { section_index: number; claims: { text: string; status: "supported" | "partial" | "unsupported"; source_ids: string[] }[] }[]; model: string; checked_at: string; stale: boolean }
export interface OriginalityReport { sections: { index: number; heading: string; overlap: "none" | "paraphrase" | "verbatim"; note: string | null; source_ref: string | null }[]; summary: { verbatim: number; paraphrase: number; clean: number; total: number }; model: string; checked_at: string; stale: boolean }
export interface QualityReport { coverage: CoverageReport; readability: Readability; grounding: GroundingReport | null; originality: OriginalityReport | null }
export interface FeedbackView {
  id: string; version_id: string; author_kind: string; author_name: string | null;
  body: string; created_at: string | null; section_index: number | null;
}
export interface VersionDetailView {
  id: string; artifact_id: string; version_no: number;
  content: { sections: DraftSection[] };
  generation_meta: Record<string, unknown> | null;
  is_validated: boolean; recorded_via: string | null; created_at: string | null;
  feedback: FeedbackView[];
  quality?: QualityReport | null;
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
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null; topic: string | null; audience: string | null; goal: string | null }
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
  quality?: QualityReport | null;
}
export interface TopicVersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean }

// Phase A async per-topic generate (T2): POST .../generate now returns 202 +
// this job handle immediately; the actual generation runs in a Celery worker.
export interface TopicGenerateJobOut { job_id: string; status: string }
// The job's eventual persisted result, once `status` is "done" — polled from
// the SAME shared GET /api/v1/jobs/{id} endpoint /generate uses (see
// backend/src/trust/router.py's generate_topic docstring) via the shared
// `pollJob<TopicGenerateJobResult>` (@/api/pollJob, used by
// useGenerateTopicJob).
export interface TopicGenerateJobResult { version_id: string; topic_id: string; version_no: number }

// STT capture (slice 2): submit returns an async job; the transcript version
// arrives via pollJob<TranscribeJobResult> (@/api/pollJob).
export interface TranscribeJobOut { job_id: string; status: string }
export interface TranscribeJobResult { artifact_id: string; version_id: string; version_no: number }

// Submit an audio file for transcription. Multipart — NOT the JSON trustFetch:
// we must let fetch set the multipart boundary, so no Content-Type header here.
// Owner-only on the backend. Returns the async job; poll GET /api/v1/jobs/{id}
// for the transcript artifact_version. Omitting providerId/apiKey lets the
// backend use the managed default STT provider.
export async function transcribeAudio(
  projectId: string,
  args: { asset: PickedAudio; language: string; title?: string; providerId?: string; apiKey?: string },
  token: string,
): Promise<TranscribeJobOut> {
  const body = await buildAudioForm(args.asset, {
    language: args.language,
    title: args.title,
    providerId: args.providerId,
    apiKey: args.apiKey,
  });
  const res = await fetch(`${resolveBaseUrl()}/api/v1/trust/projects/${projectId}/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<TranscribeJobOut>;
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

// A transcript version's content — a different stored shape than a draft's
// {sections}. start/end/confidence may be null; speaker is null until tagged.
export interface TranscriptSegment {
  text: string;
  start: number | null;
  end: number | null;
  confidence: number | null;
  speaker: string | null;
}
export interface TranscriptContent {
  language: string;
  segments: TranscriptSegment[];
  source_audio_ref?: string;
  stt_meta?: { provider?: string; model?: string };
}
export interface TranscriptVersionDetail {
  id: string;
  artifact_id: string;
  version_no: number;
  content: TranscriptContent;
  is_validated: boolean;
  recorded_via: string | null;
  created_at: string | null;
}

// GET a transcript version. Same /versions/{id} endpoint as getVersion, but the
// stored content is a transcript ({segments}), not a draft ({sections}) — so it
// gets its own type rather than a lie-typed cast.
export async function getTranscriptVersion(versionId: string, token: string): Promise<TranscriptVersionDetail> {
  return (await trustFetch<TranscriptVersionDetail>(`/versions/${versionId}`, token, { method: "GET" })) as TranscriptVersionDetail;
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
  versionId: string, body: { body: string; section_index?: number | null }, token: string,
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
// actual generation runs in a Celery worker. Poll via the shared
// `pollJob<GenerateVersionJobResult>` (@/api/pollJob, used by
// useGenerateVersionJob) for the eventual `done`/`failed` result, off the
// SAME shared GET /api/v1/jobs/{id} endpoint /generate, the per-topic
// generate, and suggest-toc jobs also use.
export interface VersionGenerateJobOut { job_id: string; status: string }
export interface GenerateVersionJobResult { version_id: string; artifact_id: string; version_no: number }

export async function generateVersion(
  artifactId: string, body: { api_key?: string; provider_id?: string; model?: string; guidance?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/artifacts/${artifactId}/versions/generate`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

// On-demand quality/grounding check (T4/T6): POST .../grounding-check
// returns 202 + this job handle immediately (same shape as generateVersion);
// the actual LLM grounding pass runs in a Celery worker. Poll via the shared
// GET /api/v1/jobs/{id} endpoint (@/api/pollJob), then refetch the version so
// `quality.grounding` reflects the fresh result.
export async function runGroundingCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/artifacts/versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

export async function runTopicGroundingCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/topic-versions/${versionId}/grounding-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

// On-demand originality/source-overlap check (B3 T4): POST
// .../originality-check returns 202 + this job handle immediately (same
// shape as runGroundingCheck); the actual LLM pass runs in a Celery worker.
// Poll via the shared GET /api/v1/jobs/{id} endpoint (@/api/pollJob), then
// refetch the version so `quality.originality` reflects the fresh result.
// Checks the draft against ITS OWN cited sources only — never the web.
export async function runOriginalityCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/artifacts/versions/${versionId}/originality-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

export async function runTopicOriginalityCheck(
  versionId: string, body: { api_key?: string; provider_id?: string; model?: string }, token: string,
): Promise<VersionGenerateJobOut> {
  return (await trustFetch<VersionGenerateJobOut>(
    `/topic-versions/${versionId}/originality-check`, token, { method: "POST", body: JSON.stringify(body) },
  )) as VersionGenerateJobOut;
}

export async function invite(projectId: string, email: string, role: "reviewer" | "editor", token: string): Promise<InvitationView> {
  return (await trustFetch<InvitationView>(`/projects/${projectId}/invitations`, token, { method: "POST", body: JSON.stringify({ email, role }) })) as InvitationView;
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

// Owner-only hard delete of a project + everything under it (DB ON DELETE
// CASCADE). Irreversible.
export async function deleteProject(projectId: string, token: string): Promise<void> {
  await trustFetch<null>(`/projects/${projectId}`, token, { method: "DELETE" });
}

// Phase B async suggest-TOC (T1/T2): POST .../suggest-toc now returns 202 +
// this job handle immediately; the actual outline generation runs in a
// Celery worker. Poll via the shared `pollJob<SuggestTocJobResult>`
// (@/api/pollJob, used by useSuggestTocJob) for the eventual `done`/`failed`
// result.
export interface TocSuggestJobOut { job_id: string; status: string }
export interface SuggestTocJobResult { toc: StructuredTocView }

export async function suggestToc(
  projectId: string, body: { api_key?: string; provider_id?: string }, token: string,
): Promise<TocSuggestJobOut> {
  return (await trustFetch<TocSuggestJobOut>(
    `/projects/${projectId}/suggest-toc`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TocSuggestJobOut;
}

export async function saveToc(projectId: string, toc: StructuredTocView, token: string): Promise<void> {
  await trustFetch(`/projects/${projectId}/toc`, token, { method: "PUT", body: JSON.stringify({ toc }) });
}

// Owner-only rights attestation (B3 Part B, display-only — never gates
// export). attested=false withdraws a prior attestation.
export async function saveRights(
  projectId: string, body: { attested: boolean; rights_holder?: string }, token: string,
): Promise<ProjectView> {
  return (await trustFetch<ProjectView>(
    `/projects/${projectId}/rights`, token, { method: "PUT", body: JSON.stringify(body) },
  )) as ProjectView;
}

// Submits a per-topic generate as an async job (Phase A / T2) — the backend
// returns 202 + {job_id, status:"queued"} immediately; poll via the shared
// `pollJob<TopicGenerateJobResult>` (@/api/pollJob) for the eventual
// `done`/`failed` result. Callers wanting a single submit-then-poll promise
// should use `useGenerateTopicJob` rather than polling this directly.
export async function generateTopic(
  projectId: string, topicId: string, body: { api_key?: string; provider_id?: string; model?: string; guidance?: string }, token: string,
): Promise<TopicGenerateJobOut> {
  return (await trustFetch<TopicGenerateJobOut>(
    `/projects/${projectId}/topics/${topicId}/generate`, token, { method: "POST", body: JSON.stringify(body) },
  )) as TopicGenerateJobOut;
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

// Project-wide "Revision notes" log (T2): all feedback across every draft in
// the project — both whole-book artifact versions AND per-topic versions —
// newest-first. Read-only; the Feedback phase's Revision-notes section fails
// open to an empty list on any fetch error rather than erroring the panel.
export interface ProjectFeedbackItem {
  source: string; draft_label: string; format: string | null; version_no: number;
  author_kind: string; author_name: string | null; body: string; created_at: string | null;
}

export async function listProjectFeedback(projectId: string, token: string): Promise<ProjectFeedbackItem[]> {
  return (await trustFetch<ProjectFeedbackItem[]>(`/projects/${projectId}/feedback`, token)) as ProjectFeedbackItem[];
}

// Whole-book generate fan-out (ADR-037 book generation, T4/T5): unlike the
// other generate submits, progress lives in a durable Postgres
// `generation_job` row (not the ephemeral Redis job status), since the run
// is a sequential fan-out over every still-missing TOC topic and can span
// well past a single request's lifetime. `estimateBook` is a read-only
// pre-run token/cost estimate the mobile client shows in a confirm before
// `generateBook` submits the fan-out; `getGenerationJob`/
// `latestGenerationJob` poll that row's progress (`done`/`total`,
// `failed_topic_ids`) once submitted.
export interface BookEstimate {
  missing_topics: number;
  est_input_tokens: number;
  est_output_tokens_max: number;
  est_cost_micros_max: number;
  // Caller's remaining headroom against its managed allowance/ceiling — null
  // when the caller has no managed grant (BYOK, or not managed-eligible at
  // all), since there's no cap to measure against.
  remaining_micros: number | null;
  // Only ever true when remaining_micros is not null.
  would_exceed: boolean;
}
export interface GenerateBookJobOut { job_id: string; total: number }
export interface GenerationJob {
  id: string;
  project_id: string;
  status: string;
  total: number;
  done: number;
  failed_topic_ids: string[];
  created_at: string | null;
}

export async function estimateBook(projectId: string, token: string): Promise<BookEstimate> {
  return (await trustFetch<BookEstimate>(
    `/projects/${projectId}/generate-book/estimate`, token, { method: "GET" },
  )) as BookEstimate;
}

// Keyless-aware like generateVersion/generateTopic/suggestToc, but with a
// camelCase `apiKey` options object (rather than forwarding a snake_case
// body) since this is the only trust client method Task 5 introduces
// alongside its call site — an omitted/undefined apiKey omits `api_key`
// from the POST body entirely (never sends `""`), which is what the
// backend's `GenerateBookIn` (api_key: str | None = None ⇒ managed) expects.
export async function generateBook(
  projectId: string, token: string, opts?: { apiKey?: string },
): Promise<GenerateBookJobOut> {
  const body: { api_key?: string } = {};
  if (opts?.apiKey) body.api_key = opts.apiKey;
  return (await trustFetch<GenerateBookJobOut>(
    `/projects/${projectId}/generate-book`, token, { method: "POST", body: JSON.stringify(body) },
  )) as GenerateBookJobOut;
}

export async function getGenerationJob(jobId: string, token: string): Promise<GenerationJob> {
  return (await trustFetch<GenerationJob>(`/generation-jobs/${jobId}`, token, { method: "GET" })) as GenerationJob;
}

export async function latestGenerationJob(projectId: string, token: string): Promise<GenerationJob | null> {
  return (await trustFetch<GenerationJob>(
    `/projects/${projectId}/generation-jobs/latest`, token, { method: "GET" },
  )) as GenerationJob | null;
}
