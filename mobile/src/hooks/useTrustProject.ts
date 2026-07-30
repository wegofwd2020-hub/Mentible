import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { addProjectInput, approveVersion, createArtifact, createVersion, generateVersion as generateVersionApi, getProject, invite as inviteApi, type ApprovalView, type ProjectDetailView, type ProjectInputView } from "@/api/trustClient";
import { loadApiKey } from "@/secure/keyStore";

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
    async (versionId: string, note?: string): Promise<ApprovalView> => {
      if (!accessToken) throw new Error("Not signed in");
      const ap = await approveVersion(versionId, { approved_at: new Date().toISOString(), note }, accessToken);
      await refresh();
      return ap;
    },
    [accessToken, refresh],
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

  const generateVersion = useCallback(async (artifactId: string) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await generateVersionApi(artifactId, { api_key: key, provider_id: "anthropic" }, accessToken);
    await refresh(); return v;
  }, [accessToken, refresh]);

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

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setProject(null);
  }, [status, refresh]);

  const inputs = project?.inputs ?? [];

  return { project, loading, error, refresh, approve, addArtifact, addVersion, generateVersion, invite, addInput, inputs };
}
