import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View, Pressable } from "react-native";
import { Stack } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { PageContainer } from "@/components/PageContainer";
import { spacing, typography } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

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

const makeStyles = (theme: any) => ({
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.text,
    marginBottom: spacing.md,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: spacing.lg,
  },
  row: {
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.error,
  },
  email: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.text,
    marginBottom: spacing.xs,
  },
  detail: {
    fontSize: 12,
    color: theme.textSecondary,
    marginBottom: spacing.xs,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  badge: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.error,
  },
  button: {
    backgroundColor: theme.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  errorText: {
    color: theme.error,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  emptyText: {
    color: theme.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});

export default function SettingsAnalyticsScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { account } = useAccount();

  const [users, setUsers] = useState<StalledUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Super-admin only
  const isAdmin = account?.is_super_admin === true;

  useEffect(() => {
    if (isAdmin && accessToken) {
      fetchStalledUsers();
    }
  }, [isAdmin, accessToken]);

  const fetchStalledUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || "";
      const response = await fetch(
        `${apiBase}/api/v1/analytics/dashboards/stalled-users-global`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Admin access required"
            : "Failed to fetch stalled users"
        );
      }

      const result = await response.json();
      setUsers(result.stalled_users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleResendIntervention = async (userId: string) => {
    // TODO: Call backend to re-send intervention for this user
    console.log("Re-send intervention for user:", userId);
  };

  // Super-admin gate
  if (account && !isAdmin) {
    return (
      <PageContainer>
        <Stack.Screen options={{ title: "Analytics" }} />
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
        <Stack.Screen options={{ title: "Analytics" }} />
        <Text style={styles.errorText}>Error: {error}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Stalled Users" }} />
      <Text style={styles.title}>Stalled Users</Text>
      <Text style={styles.subtitle}>
        {users.length} user{users.length === 1 ? "" : "s"} stuck in projects
      </Text>

      {users.length === 0 ? (
        <Text style={styles.emptyText}>No stalled users</Text>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.user_id + "-" + item.project_id}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.email}>{item.email}</Text>
              <Text style={styles.detail}>
                Project: <Text style={{ fontWeight: "600" }}>
                  {item.project_name}
                </Text>
              </Text>
              <Text style={styles.detail}>
                Stuck at: <Text style={{ fontWeight: "600" }}>
                  {item.journey_stage}
                </Text>
              </Text>
              <Text style={styles.detail}>
                Last accessed:{" "}
                {new Date(item.stalled_at).toLocaleDateString()}
              </Text>
              {item.last_intervention_sent_at && (
                <Text style={styles.detail}>
                  Last reminder sent:{" "}
                  {new Date(
                    item.last_intervention_sent_at
                  ).toLocaleDateString()}
                </Text>
              )}

              <View style={styles.footer}>
                <Text style={styles.badge}>
                  {item.days_stalled} days · {item.intervention_attempt_count}{" "}
                  reminder{item.intervention_attempt_count === 1 ? "" : "s"}
                </Text>
                <Pressable
                  style={styles.button}
                  onPress={() => handleResendIntervention(item.user_id)}
                >
                  <Text style={styles.buttonText}>Re-send</Text>
                </Pressable>
              </View>
            </View>
          )}
          scrollEnabled
        />
      )}
    </PageContainer>
  );
}
