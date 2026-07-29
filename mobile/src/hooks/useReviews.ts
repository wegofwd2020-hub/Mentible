import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getProject, syncSession } from "@/api/trustClient";

export interface ReviewSummary {
  projectId: string; title: string; versionsTotal: number; versionsValidated: number;
}

export function useReviews() {
  const { accessToken, status } = useAuth();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const sync = await syncSession(accessToken);
      const reviewerProjects = sync.memberships.filter((m) => m.role === "reviewer");
      const details = await Promise.all(
        reviewerProjects.map((m) => getProject(m.project_id, accessToken)),
      );
      setReviews(
        details.map((d) => {
          const versions = d.artifacts.flatMap((a) => a.versions);
          return {
            projectId: d.project.id,
            title: d.project.title,
            versionsTotal: versions.length,
            versionsValidated: versions.filter((v) => v.is_validated).length,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your reviews.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setReviews([]);
  }, [status, refresh]);

  return { reviews, loading, error, refresh };
}
