import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getProject, syncSession, type ProjectDetailView, type VersionSummaryView } from "@/api/trustClient";

export interface ReviewProject {
  projectId: string;
  title: string;
  versionsTotal: number;
  versionsValidated: number;
  detail: ProjectDetailView;
  versions: Array<{ artifactId: string; artifactTitle: string; artifactFormat: string } & VersionSummaryView>;
}

export function useReviews() {
  const { accessToken, status } = useAuth();
  const [reviews, setReviews] = useState<ReviewProject[]>([]);
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
          const versions = d.artifacts.flatMap((a) =>
            a.versions.map((v) => ({
              ...v,
              artifactId: a.artifact.id,
              artifactTitle: a.artifact.title || a.artifact.format,
              artifactFormat: a.artifact.format,
            })),
          );
          return {
            projectId: d.project.id,
            title: d.project.title,
            versionsTotal: versions.length,
            versionsValidated: versions.filter((v) => v.is_validated).length,
            detail: d,
            versions,
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
