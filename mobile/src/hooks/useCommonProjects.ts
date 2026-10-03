import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import {
  listCommonProjects,
  getCommonProject,
  importCommonProject,
  updateCommonProject,
  deleteCommonProject,
  type CommonProjectSummary,
  type CommonProjectDetail,
  type ProjectView,
} from "@/api/trustClient";

export function useCommonProjects(opts?: { q?: string; tag?: string; limit?: number; offset?: number }) {
  const { accessToken, status } = useAuth();
  const [projects, setProjects] = useState<CommonProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setProjects(await listCommonProjects(accessToken, opts));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load common projects.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, opts]);

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setProjects([]);
  }, [status, refresh]);

  return { projects, loading, error, refresh };
}

export function useCommonProject(projectId: string) {
  const { accessToken } = useAuth();
  const [project, setProject] = useState<CommonProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await getCommonProject(projectId, accessToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, accessToken]);

  const import_ = useCallback(async (): Promise<ProjectView> => {
    if (!accessToken) throw new Error("Not signed in");
    return importCommonProject(projectId, accessToken);
  }, [projectId, accessToken]);

  const update = useCallback(
    async (body: { title: string; description?: string; project_data: Record<string, unknown> }): Promise<CommonProjectDetail> => {
      if (!accessToken) throw new Error("Not signed in");
      const updated = await updateCommonProject(projectId, body, accessToken);
      setProject(updated);
      return updated;
    },
    [projectId, accessToken],
  );

  const remove = useCallback(async (): Promise<void> => {
    if (!accessToken) throw new Error("Not signed in");
    await deleteCommonProject(projectId, accessToken);
    setProject(null);
  }, [projectId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { project, loading, error, import: import_, update, remove };
}
