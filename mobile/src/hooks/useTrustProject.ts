import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { addProjectInput, addTopicFeedback as addTopicFeedbackApi, approveVersion, createArtifact, createTopicVersion, createVersion, deleteInput, getProject, getTopicVersions, getVersion, invite as inviteApi, recordTopicApproval, saveToc as saveTocApi, updateInput, withdrawApproval, withdrawTopicApproval, type ApprovalView, type ProjectDetailView, type ProjectInputView, type StructuredTocView, type TopicApprovalView, type TopicFeedbackView, type TopicVersionCreatedView, type TopicVersionSummaryView, type VersionDetailView } from "@/api/trustClient";
import { useGenerateTopicJob } from "@/hooks/useGenerateTopicJob";
import { useGenerateVersionJob } from "@/hooks/useGenerateVersionJob";
import { useSuggestTocJob } from "@/hooks/useSuggestTocJob";
import { loadApiKey } from "@/secure/keyStore";
import type { DraftFormat } from "@/constants/draftFormats";

export function useTrustProject(projectId: string) {
  const { accessToken, status } = useAuth();
  // Pro users with no saved BYOK key generate keyless (managed): the backend
  // covers the vendor call. Free/unknown-plan users without a key still get
  // the "add a key" nudge. A saved key is always BYOK, regardless of plan.
  const { plan } = useBillingPlan();
  const isPro = plan?.is_pro === true;
  const [project, setProject] = useState<ProjectDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await getProject(projectId, accessToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this project.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, projectId]);

  const approve = useCallback(
    async (versionId: string, opts?: { note?: string; expertName?: string }): Promise<ApprovalView> => {
      if (!accessToken) throw new Error("Not signed in");
      const ap = await approveVersion(
        versionId,
        { approved_at: new Date().toISOString(), note: opts?.note, expert_name: opts?.expertName },
        accessToken,
      );
      await refresh();
      return ap;
    },
    [accessToken, refresh],
  );

  const unapprove = useCallback(
    async (versionId: string, note?: string): Promise<ApprovalView> => {
      if (!accessToken) throw new Error("Not signed in");
      const ap = await withdrawApproval(versionId, { note }, accessToken);
      await refresh();
      return ap;
    },
    [accessToken, refresh],
  );

  const loadVersionContent = useCallback(
    async (versionId: string): Promise<VersionDetailView> => {
      if (!accessToken) throw new Error("Not signed in");
      return getVersion(versionId, accessToken);
    },
    [accessToken],
  );

  const addArtifact = useCallback(async (role: string, format: string, title?: string) => {
    if (!accessToken) throw new Error("Not signed in");
    const a = await createArtifact(projectId, { role, format, title }, accessToken);
    await refresh(); return a;
  }, [accessToken, projectId, refresh]);

  const addVersion = useCallback(async (artifactId: string, content: object) => {
    if (!accessToken) throw new Error("Not signed in");
    const v = await createVersion(artifactId, { content }, accessToken);
    await refresh(); return v;
  }, [accessToken, refresh]);

  // Async whole-book/whole-artifact generate (Phase C / T2): submit returns a
  // job_id immediately, `runGenerateVersionJob` polls the shared /jobs/{id}
  // until done|failed. Resolves to the same {id, artifact_id, version_no,
  // created_at} shape the old synchronous call returned, so callers
  // ([projectId].tsx's generateFormat, version/[versionId].tsx's
  // generateVersion) don't need to change beyond passing an optional
  // `onPhase`.
  const { run: runGenerateVersionJob } = useGenerateVersionJob();

  const generateVersion = useCallback(async (artifactId: string, opts?: { guidance?: string; onPhase?: (p: "queued" | "running") => void }) => {
    const key = await loadApiKey("anthropic");
    if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await runGenerateVersionJob({ artifactId, apiKey: key ?? undefined, accessToken, guidance: opts?.guidance, onPhase: opts?.onPhase });
    await refresh(); return v;
  }, [accessToken, isPro, refresh, runGenerateVersionJob]);

  const generateFormat = useCallback(async (fmt: DraftFormat, opts?: { onPhase?: (p: "queued" | "running") => void }) => {
    const key = await loadApiKey("anthropic");
    if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const a = await createArtifact(projectId, { role: fmt.role, format: fmt.format, title: fmt.label }, accessToken);
    const v = await runGenerateVersionJob({ artifactId: a.id, apiKey: key ?? undefined, accessToken, onPhase: opts?.onPhase });
    await refresh();
    return v;
  }, [accessToken, isPro, projectId, refresh, runGenerateVersionJob]);

  // Async suggest-TOC (Phase B / T2): submit returns a job_id immediately,
  // `runSuggestTocJob` polls the shared /jobs/{id} until done|failed.
  // Resolves to the same StructuredTocView the old synchronous call
  // returned, so callers (the Structure screen's Suggest button) don't
  // need to change beyond passing an optional `onPhase`.
  const { run: runSuggestTocJob } = useSuggestTocJob();

  const suggestToc = useCallback(async (opts?: { onPhase?: (p: "queued" | "running") => void }): Promise<StructuredTocView> => {
    const key = await loadApiKey("anthropic");
    if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to suggest an outline.");
    if (!accessToken) throw new Error("Not signed in");
    return runSuggestTocJob({ projectId, apiKey: key ?? undefined, accessToken, onPhase: opts?.onPhase });
  }, [accessToken, isPro, projectId, runSuggestTocJob]);

  const saveToc = useCallback(async (toc: StructuredTocView) => {
    if (!accessToken) throw new Error("Not signed in");
    await saveTocApi(projectId, toc, accessToken);
    await refresh();
  }, [accessToken, projectId, refresh]);

  const invite = useCallback(async (email: string) => {
    if (!accessToken) throw new Error("Not signed in");
    const inv = await inviteApi(projectId, email, accessToken);
    await refresh(); return inv;
  }, [accessToken, projectId, refresh]);

  const addInput = useCallback(async (body: { kind: "transcript" | "note" | "link"; title?: string; content: string; source_ref?: string }): Promise<ProjectInputView> => {
    if (!accessToken) throw new Error("Not signed in");
    const i = await addProjectInput(projectId, body, accessToken);
    await refresh(); return i;
  }, [accessToken, projectId, refresh]);

  const editInput = useCallback(async (inputId: string, body: { title?: string; content?: string; source_ref?: string }) => {
    if (!accessToken) throw new Error("Not signed in");
    const i = await updateInput(inputId, body, accessToken);
    await refresh(); return i;
  }, [accessToken, refresh]);

  const removeInput = useCallback(async (inputId: string) => {
    if (!accessToken) throw new Error("Not signed in");
    await deleteInput(inputId, accessToken);
    await refresh();
  }, [accessToken, refresh]);

  // Async per-topic generate (Phase A / T2): submit returns a job_id
  // immediately, `runTopicGenJob` polls the shared /jobs/{id} until
  // done|failed. Resolves to the same {id, topic_id, version_no, created_at}
  // shape the old synchronous call returned, so callers (DraftsPanel's
  // onGenerateTopic, the topic-viewer's doRegen) don't need to change.
  const { run: runTopicGenJob } = useGenerateTopicJob();

  const generateTopic = useCallback(async (topicId: string, opts?: { guidance?: string; onPhase?: (p: "queued" | "running") => void }): Promise<TopicVersionCreatedView> => {
    const key = await loadApiKey("anthropic");
    if (!key && !isPro) throw new Error("No API key saved. Add an Anthropic key in Settings to generate.");
    if (!accessToken) throw new Error("Not signed in");
    const result = await runTopicGenJob({ projectId, topicId, apiKey: key ?? undefined, accessToken, guidance: opts?.guidance, onPhase: opts?.onPhase });
    await refresh();
    return { id: result.version_id, topic_id: result.topic_id, version_no: result.version_no, created_at: null };
  }, [accessToken, isPro, projectId, refresh, runTopicGenJob]);

  const approveTopic = useCallback(async (id: string, opts?: { note?: string; expertName?: string }): Promise<TopicApprovalView> => {
    if (!accessToken) throw new Error("Not signed in");
    const ap = await recordTopicApproval(id, { approved_at: new Date().toISOString(), note: opts?.note, expert_name: opts?.expertName }, accessToken);
    await refresh(); return ap;
  }, [accessToken, refresh]);

  const withdrawTopic = useCallback(async (id: string) => {
    if (!accessToken) throw new Error("Not signed in");
    await withdrawTopicApproval(id, {}, accessToken);
    await refresh();
  }, [accessToken, refresh]);

  const listTopicVersions = useCallback(async (topicId: string): Promise<TopicVersionSummaryView[]> => {
    if (!accessToken) throw new Error("Not signed in");
    return getTopicVersions(projectId, topicId, accessToken);
  }, [accessToken, projectId]);

  const addTopicFeedback = useCallback(async (topicVersionId: string, body: { body: string }): Promise<TopicFeedbackView> => {
    if (!accessToken) throw new Error("Not signed in");
    return addTopicFeedbackApi(topicVersionId, body, accessToken);
  }, [accessToken]);

  const editTopic = useCallback(async (topicId: string, content: object): Promise<TopicVersionCreatedView> => {
    if (!accessToken) throw new Error("Not signed in");
    const v = await createTopicVersion(projectId, topicId, content, accessToken);
    await refresh(); return v;
  }, [accessToken, projectId, refresh]);

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setProject(null);
  }, [status, refresh]);

  const inputs = project?.inputs ?? [];

  return { project, loading, error, refresh, approve, unapprove, loadVersionContent, addArtifact, addVersion, generateVersion, generateFormat, suggestToc, saveToc, invite, addInput, editInput, removeInput, inputs, generateTopic, approveTopic, withdrawTopic, listTopicVersions, addTopicFeedback, editTopic, accessToken };
}
