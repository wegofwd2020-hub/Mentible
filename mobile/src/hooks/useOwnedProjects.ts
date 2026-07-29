import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { createProject, listOwnedProjects, type ProjectSummaryView, type ProjectView } from "@/api/trustClient";

export function useOwnedProjects() {
  const { accessToken, status } = useAuth();
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError(null);
    try { setProjects(await listOwnedProjects(accessToken)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load your projects."); }
    finally { setLoading(false); }
  }, [accessToken]);

  const create = useCallback(async (body: { title: string; topic?: string; audience?: string; goal?: string }): Promise<ProjectView> => {
    if (!accessToken) throw new Error("Not signed in");
    const p = await createProject(body, accessToken);
    await refresh();
    return p;
  }, [accessToken, refresh]);

  useEffect(() => { if (status === "signed_in") void refresh(); else setProjects([]); }, [status, refresh]);
  return { projects, loading, error, refresh, create };
}
