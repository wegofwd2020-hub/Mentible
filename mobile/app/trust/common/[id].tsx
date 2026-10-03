import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useCommonProject } from "@/hooks/useCommonProjects";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button, Card, Label } from "@/components/ui";
import Alert from "@/lib/alert";
import { Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import type { ApiError } from "@/api/client";

const makeStyles = (c: Palette) => ({
  container: { flex: 1, paddingVertical: 16 },
  header: { paddingHorizontal: 16, marginBottom: 24 },
  kicker: { color: c.secondary, marginBottom: 4 },
  title: { fontSize: 28, fontFamily: FRAUNCES, fontWeight: "600", color: c.foreground, marginBottom: 8 },
  author: { fontSize: 14, color: c.secondary },
  description: { fontSize: 16, color: c.foreground, lineHeight: 24, marginBottom: 24, paddingHorizontal: 16 },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: c.tertiary, textTransform: "uppercase", marginBottom: 8, paddingHorizontal: 16 },
  tocPreview: { paddingHorizontal: 16, marginBottom: 24 },
  tocItem: { fontSize: 14, color: c.foreground, lineHeight: 20, marginBottom: 4 },
  actions: { paddingHorizontal: 16, gap: 8, marginBottom: 24 },
  buttonGroup: { flexDirection: "row", gap: 8 },
  dangerZone: { paddingHorizontal: 16, marginTop: 32, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border },
  error: { color: c.error, padding: 16, textAlign: "center" },
});

export default function CommonProjectDetailScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id || "";
  const { project, loading, error, import: import_, update, remove } = useCommonProject(projectId);

  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const styles = useThemedStyles(makeStyles);

  const isAuthor = project && session?.user?.id === project.author_id;

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const newProject = await import_();
      router.replace(`/trust/${newProject.id}`);
    } catch (e) {
      const msg = e instanceof Object && "status" in e && (e as ApiError).userMessage?.()
        ? (e as ApiError).userMessage?.()
        : e instanceof Error ? e.message : "Import failed";
      Alert.alert("Couldn't import project", msg);
      setImporting(false);
    }
  }, [import_, router]);

  const handleDelete = useCallback(() => {
    Alert.alert("Delete this project?", "This action can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await remove();
            router.replace("/trust/common");
          } catch (e) {
            Alert.alert("Couldn't delete", e instanceof Error ? e.message : "Please try again.");
            setDeleting(false);
          }
        },
      },
    ]);
  }, [remove, router]);

  if (loading && !project) {
    return <ActivityIndicator size="large" style={{ flex: 1, justifyContent: "center" }} />;
  }

  if (error) {
    return <Text style={styles.error}>{error}</Text>;
  }

  if (!project) {
    return <Text style={styles.error}>Project not found</Text>;
  }

  const toc = project.project_data?.toc as Record<string, unknown> | undefined;

  return (
    <PageContainer style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Label style={styles.kicker}>SHARED PROJECT</Label>
          <Text style={styles.title}>{project.title}</Text>
          <Text style={styles.author}>By {project.author_id}</Text>
        </View>

        {project.description && <Text style={styles.description}>{project.description}</Text>}

        {toc && (
          <View style={styles.tocPreview}>
            <Text style={styles.sectionLabel}>Table of Contents</Text>
            {typeof toc === "object" && Object.keys(toc).slice(0, 5).map((key) => (
              <Text key={key} style={styles.tocItem}>
                • {String(toc[key])}
              </Text>
            ))}
            {Object.keys(toc).length > 5 && <Text style={styles.tocItem}>• ... and {Object.keys(toc).length - 5} more topics</Text>}
          </View>
        )}

        <View style={styles.actions}>
          <Button label="Import to My Projects" onPress={handleImport} busy={importing} />

          {isAuthor && (
            <View style={styles.dangerZone}>
              <Button label="Delete Project" onPress={handleDelete} busy={deleting} variant="ghost" />
            </View>
          )}
        </View>
      </ScrollView>
    </PageContainer>
  );
}
