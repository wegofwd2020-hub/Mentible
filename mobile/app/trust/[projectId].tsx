import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function TrustProjectDetail() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { project, loading, error, approve } = useTrustProject(String(projectId));
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !project) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!project) return null;

  const onApprove = (versionId: string, versionNo: number) => {
    Alert.alert(
      "Record approval",
      `Record your approval of v${versionNo}? It is logged as expert-validated by you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy(versionId);
            try {
              const ap = await approve(versionId);
              Alert.alert("Approved", ap.recorded_via === "expert_self" ? "Recorded as expert-validated." : "Approval recorded.");
            } catch (e) {
              Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <Text style={styles.title}>{project.project.title}</Text>
        {project.project.topic ? <Text style={styles.topic}>{project.project.topic}</Text> : null}
        {project.artifacts.map(({ artifact, versions }) => (
          <View key={artifact.id} style={styles.artifact}>
            <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
            {versions.map((v) => (
              <View key={v.id} style={styles.versionRow}>
                <Text style={styles.versionLabel}>v{v.version_no}</Text>
                {v.is_validated ? (
                  <Text accessibilityLabel={`Version ${v.version_no} validated`} style={styles.validated}>Validated ✓</Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Approve version ${v.version_no}`}
                    disabled={busy === v.id}
                    style={styles.approveBtn}
                    onPress={() => onApprove(v.id, v.version_no)}
                  >
                    <Text style={styles.approveText}>{busy === v.id ? "…" : "Approve"}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ))}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  topic: { color: colors.textSecondary, fontSize: typography.sizeMd },
  artifact: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  artifactTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  versionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  versionLabel: { color: colors.textSecondary, fontSize: typography.sizeMd },
  validated: { color: colors.growth, fontSize: typography.sizeSm, fontWeight: "700" },
  approveBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  approveText: { color: colors.primaryText, fontSize: typography.sizeSm, fontWeight: "700" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
