import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { addProjectInput, addTopicFeedback as addTopicFeedbackApi, approveVersion, createArtifact, createTopicVersion, createVersion, deleteInput, generateTopic as generateTopicApi, generateVersion as generateVersionApi, getProject, getTopicVersions, getVersion, invite as inviteApi, recordTopicApproval, saveToc as saveTocApi, suggestToc as suggestTocApi, updateInput, withdrawApproval, withdrawTopicApproval, type ApprovalView, type ProjectDetailView, type ProjectInputView, type StructuredTocView, type TopicApprovalView, type TopicFeedbackView, type TopicVersionCreatedView, type TopicVersionSummaryView, type VersionDetailView } from "@/api/trustClient";
import { loadApiKey } from "@/secure/keyStore";
import type { DraftFormat } from "@/constants/draftFormats";

export function useTrustProject(projectId: string) {
  const { accessToken, status } = useAuth();
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

  const generateVersion = useCallback(async (artifactId: string, opts?: { guidance?: string }) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await generateVersionApi(artifactId, { api_key: key, provider_id: "anthropic", guidance: opts?.guidance }, accessToken);
    await refresh(); return v;
  }, [accessToken, refresh]);

  const generateFormat = useCallback(async (fmt: DraftFormat) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const a = await createArtifact(projectId, { role: fmt.role, format: fmt.format, title: fmt.label }, accessToken);
    const v = await generateVersionApi(a.id, { api_key: key, provider_id: "anthropic" }, accessToken);
    await refresh();
    return v;
  }, [accessToken, projectId, refresh]);

  const suggestToc = useCallback(async (): Promise<StructuredTocView> => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to suggest an outline.");
    if (!accessToken) throw new Error("Not signed in");
    return suggestTocApi(projectId, { api_key: key, provider_id: "anthropic" }, accessToken);
  }, [accessToken, projectId]);

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

  const generateTopic = useCallback(async (topicId: string, opts?: { guidance?: string }) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await generateTopicApi(projectId, topicId, { api_key: key, provider_id: "anthropic", guidance: opts?.guidance }, accessToken);
    await refresh(); return v;
  }, [accessToken, projectId, refresh]);

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
