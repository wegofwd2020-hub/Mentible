import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { approveVersion, getProject, type ApprovalView, type ProjectDetailView } from "@/api/trustClient";

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

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setProject(null);
  }, [status, refresh]);

  return { project, loading, error, refresh, approve };
}
