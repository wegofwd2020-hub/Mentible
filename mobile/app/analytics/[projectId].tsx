import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { PageContainer } from "@/components/PageContainer";
import { spacing, typography } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

interface Bottleneck {
  project_id: string;
  journey_stage: string;
  total_users_at_stage: number;
  stalled_count: number;
  stall_rate_pct: number;
  avg_hours_before_stall: number | null;
  intervention_sent_count: number;
  resumed_after_intervention_count: number;
  re_engagement_rate_pct: number | null;
}

interface FunnelRow {
  project_id: string;
  from_stage: string;
  to_stage: string;
  users_at_from_stage: number;
  users_advanced: number;
  advancement_rate_pct: number;
}

interface StalledUser {
  user_id: string;
  email: string;
  project_id: string;
  project_name: string;
  journey_stage: string;
  stalled_at: string;
  days_stalled: number;
  intervention_attempt_count: number;
  last_intervention_sent_at: string | null;
}

interface ProjectUXAnalytics {
  bottlenecks: Bottleneck[];
  funnel: FunnelRow[];
  stalled_users: StalledUser[];
}

const makeStyles = (theme: any) => ({
  title: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: theme.text,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: theme.text,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: theme.card,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowLabel: {
    fontSize: 14,
    color: theme.textSecondary,
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600" as const,
    color: theme.text,
    textAlign: "right" as const,
  },
  stalledRow: {
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  email: {
    fontSize: 14,
    fontWeight: "500" as const,
    color: theme.text,
    marginBottom: spacing.xs,
  },
  stage: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  errorText: {
    color: theme.error,
    fontSize: 14,
    textAlign: "center" as const,
    marginTop: spacing.lg,
  },
  emptyText: {
    color: theme.textSecondary,
    fontSize: 14,
    textAlign: "center" as const,
    marginTop: spacing.lg,
  },
});

export default function ProjectAnalyticsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { account } = useAccount();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const [data, setData] = useState<ProjectUXAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Super-admin only
  const isAdmin = account?.is_super_admin === true;

  useEffect(() => {
    fetchAnalytics();
  }, [projectId, accessToken]);

  const fetchAnalytics = async () => {
    if (!projectId || !accessToken) {
      setError("Missing project ID or authentication");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || "";
      const response = await fetch(
        `${apiBase}/api/v1/analytics/dashboards/project-ux/${projectId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "Project not found"
            : "Failed to fetch analytics"
        );
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Super-admin gate
  if (account && !isAdmin) {
    return (
      <PageContainer>
        <Stack.Screen options={{ title: "Access Denied" }} />
        <Text style={styles.errorText}>
          Analytics available to super-admins only.
        </Text>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Stack.Screen
          options={{
            title: "Project Analytics",
          }}
        />
        <Text style={styles.errorText}>Error: {error}</Text>
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer>
        <Stack.Screen options={{ title: "Project Analytics" }} />
        <Text style={styles.emptyText}>No data available</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "Project Analytics",
        }}
      />
      <ScrollView>
        <Text style={styles.title}>Project UX Analytics</Text>

        {/* Bottleneck Analysis */}
        <Text style={styles.sectionTitle}>Stage Bottleneck Analysis</Text>
        <View style={styles.card}>
          {data.bottlenecks.length === 0 ? (
            <Text style={styles.emptyText}>No bottleneck data</Text>
          ) : (
            <>
              {data.bottlenecks.map((row) => (
                <View key={row.journey_stage} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{row.journey_stage}</Text>
                    <Text
                      style={[
                        styles.rowLabel,
                        { marginTop: spacing.xs, fontSize: 12 },
                      ]}
                    >
                      {row.total_users_at_stage} users · {row.stalled_count}{" "}
                      stalled
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[
                        styles.rowValue,
                        { color: theme.error, fontSize: 16 },
                      ]}
                    >
                      {row.stall_rate_pct.toFixed(1)}%
                    </Text>
                    <Text
                      style={[
                        styles.rowLabel,
                        { marginTop: spacing.xs, textAlign: "right" },
                      ]}
                    >
                      stall rate
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Funnel Analysis */}
        <Text style={styles.sectionTitle}>Completion Funnel</Text>
        <View style={styles.card}>
          {data.funnel.length === 0 ? (
            <Text style={styles.emptyText}>No funnel data</Text>
          ) : (
            <>
              {data.funnel.map((row) => (
                <View
                  key={`${row.from_stage}-${row.to_stage}`}
                  style={styles.row}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>
                      {row.from_stage} → {row.to_stage}
                    </Text>
                    <Text
                      style={[
                        styles.rowLabel,
                        { marginTop: spacing.xs, fontSize: 12 },
                      ]}
                    >
                      {row.users_advanced} of {row.users_at_from_stage}{" "}
                      advanced
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[
                        styles.rowValue,
                        { color: theme.primary, fontSize: 16 },
                      ]}
                    >
                      {row.advancement_rate_pct.toFixed(1)}%
                    </Text>
                    <Text
                      style={[
                        styles.rowLabel,
                        { marginTop: spacing.xs, textAlign: "right" },
                      ]}
                    >
                      advancement
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Stalled Users */}
        <Text style={styles.sectionTitle}>Stalled Users</Text>
        {data.stalled_users.length === 0 ? (
          <Text style={styles.emptyText}>No stalled users</Text>
        ) : (
          <View>
            {data.stalled_users.map((user) => (
              <View key={user.user_id} style={styles.stalledRow}>
                <Text style={styles.email}>{user.email}</Text>
                <Text style={styles.stage}>
                  Stage: {user.journey_stage} · Stalled {user.days_stalled}{" "}
                  day{user.days_stalled === 1 ? "" : "s"}
                </Text>
                <Text
                  style={[styles.stage, { marginTop: spacing.xs }]}
                >
                  Interventions: {user.intervention_attempt_count}
                  {user.last_intervention_sent_at && (
                    <Text>
                      {" "}
                      (last:{" "}
                      {new Date(
                        user.last_intervention_sent_at
                      ).toLocaleDateString()}
                      )
                    </Text>
                  )}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </PageContainer>
  );
}
