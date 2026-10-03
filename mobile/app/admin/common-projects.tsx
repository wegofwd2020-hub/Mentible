import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { useTheme, useThemedStyles } from "@/theme";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button, Label } from "@/components/ui";
import { Palette } from "@/constants/theme";
import Alert from "@/lib/alert";
import { takedownCommonProject, restoreCommonProject } from "@/api/adminClient";

const makeStyles = (c: Palette) => ({
  container: { flex: 1, paddingVertical: 16 },
  header: { paddingHorizontal: 16, marginBottom: 24 },
  title: { fontSize: 20, fontWeight: "600", color: c.foreground, marginBottom: 8 },
  projectRow: { paddingHorizontal: 16, marginBottom: 16, borderRadius: 8, padding: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  projectTitle: { fontSize: 16, fontWeight: "600", color: c.foreground, marginBottom: 4 },
  projectAuthor: { fontSize: 13, color: c.secondary, marginBottom: 8 },
  takenDownBadge: { fontSize: 11, color: c.error, fontWeight: "600", marginBottom: 8, backgroundColor: c.border, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, alignSelf: "flex-start" },
  actionGroup: { flexDirection: "row", gap: 8, marginTop: 8 },
  error: { color: c.error, padding: 16, textAlign: "center" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyState: { paddingVertical: 32, paddingHorizontal: 16, alignItems: "center" },
  emptyText: { fontSize: 14, color: c.secondary, textAlign: "center" },
});

interface CommonProjectRow {
  id: string;
  title: string;
  author_name: string;
  description?: string;
  taken_down_at?: string | null;
}

export default function AdminCommonProjectsScreen() {
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;
  const styles = useThemedStyles(makeStyles);

  const [projects, setProjects] = useState<CommonProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load all projects from admin list endpoint (future backend endpoint)
  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      // TODO: Implement admin GET /api/v1/admin/common-projects with pagination
      // For now, show empty state
      setProjects([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load projects.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const handleTakedown = useCallback(
    (project: CommonProjectRow) => {
      Alert.prompt(
        "Takedown project?",
        "Enter reason for takedown:",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Takedown",
            style: "destructive",
            onPress: async (reason) => {
              if (!accessToken || !reason?.trim()) return;
              setBusy(true);
              try {
                await takedownCommonProject(accessToken, project.id, reason);
                Alert.alert("Success", "Project taken down");
                await load();
              } catch (e) {
                Alert.alert("Error", e instanceof Error ? e.message : "Takedown failed");
              } finally {
                setBusy(false);
              }
            },
          },
        ],
        "plain-text"
      );
    },
    [accessToken, load]
  );

  const handleRestore = useCallback(
    (project: CommonProjectRow) => {
      Alert.alert("Restore project?", "This will make the project visible again.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "default",
          onPress: async () => {
            if (!accessToken) return;
            setBusy(true);
            try {
              await restoreCommonProject(accessToken, project.id);
              Alert.alert("Success", "Project restored");
              await load();
            } catch (e) {
              Alert.alert("Error", e instanceof Error ? e.message : "Restore failed");
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
    },
    [accessToken, load]
  );

  if (status === "unauthenticated") {
    return <Redirect href="/auth/login" />;
  }

  if (!isAdmin) {
    return (
      <PageContainer style={styles.container}>
        <Text style={styles.error}>Access denied. Super-admin required.</Text>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <PageContainer style={styles.container}>
        <Text style={styles.error}>{error}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={styles.container}>
      <View style={styles.header}>
        <Label>ADMIN</Label>
        <Text style={styles.title}>Common Projects</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No projects yet.</Text>
          </View>
        ) : (
          projects.map((p) => (
            <View key={p.id} style={styles.projectRow}>
              <Text style={styles.projectTitle}>{p.title}</Text>
              <Text style={styles.projectAuthor}>By {p.author_name}</Text>

              {p.taken_down_at && <Text style={styles.takenDownBadge}>TAKEN DOWN</Text>}

              <View style={styles.actionGroup}>
                {p.taken_down_at ? (
                  <Button label="Restore" onPress={() => handleRestore(p)} busy={busy} />
                ) : (
                  <Button label="Takedown" onPress={() => handleTakedown(p)} busy={busy} variant="destructive" />
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </PageContainer>
  );
}
