import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function TrustProjectDetail() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { project, loading, error, approve, addArtifact, addVersion, invite } = useTrustProject(String(projectId));
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [addArtifactBusy, setAddArtifactBusy] = useState(false);
  const [addVersionBusy, setAddVersionBusy] = useState<string | null>(null);

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

  const onInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    try {
      await invite(email);
      setInviteEmail("");
      Alert.alert("Invited", `Invitation sent to ${email}.`);
    } catch (e) {
      Alert.alert("Couldn't invite", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setInviteBusy(false);
    }
  };

  const onAddArtifact = async () => {
    setAddArtifactBusy(true);
    try {
      await addArtifact("cornerstone", "book");
    } catch (e) {
      Alert.alert("Couldn't add artifact", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setAddArtifactBusy(false);
    }
  };

  const onAddVersion = async (artifactId: string) => {
    setAddVersionBusy(artifactId);
    try {
      await addVersion(artifactId, { text: "" });
    } catch (e) {
      Alert.alert("Couldn't add version", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally {
      setAddVersionBusy(null);
    }
  };

  const isOwner = project.my_role === "owner";

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
                  <View style={styles.validatedRow}>
                    <Text accessibilityLabel={`Version ${v.version_no} validated`} style={styles.validated}>Validated ✓</Text>
                    {v.recorded_via === "expert_self" ? (
                      <Text style={styles.chip}>expert-validated</Text>
                    ) : v.recorded_via === "operator" ? (
                      <Text style={styles.chip}>operator-recorded</Text>
                    ) : null}
                  </View>
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
            {isOwner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a version"
                disabled={addVersionBusy === artifact.id}
                style={styles.addVersionBtn}
                onPress={() => onAddVersion(artifact.id)}
              >
                <Text style={styles.addVersionText}>{addVersionBusy === artifact.id ? "…" : "Add a version"}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {isOwner ? (
          <View style={styles.ownerBlock}>
            <Text style={styles.artifactTitle}>Owner actions</Text>
            <View style={styles.inviteRow}>
              <TextInput
                style={styles.inviteInput}
                placeholder="expert@example.com"
                placeholderTextColor={colors.textMuted}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Invite an expert"
                disabled={inviteBusy}
                style={styles.approveBtn}
                onPress={onInvite}
              >
                <Text style={styles.approveText}>{inviteBusy ? "…" : "Invite"}</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add an artifact"
              disabled={addArtifactBusy}
              style={styles.approveBtn}
              onPress={onAddArtifact}
            >
              <Text style={styles.approveText}>{addArtifactBusy ? "…" : "Add an artifact"}</Text>
            </Pressable>
          </View>
        ) : null}
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
  validatedRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  validated: { color: colors.growth, fontSize: typography.sizeSm, fontWeight: "700" },
  chip: {
    color: colors.textSecondary,
    fontSize: typography.sizeXs,
    fontWeight: "600",
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    overflow: "hidden",
  },
  approveBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  approveText: { color: colors.primaryText, fontSize: typography.sizeSm, fontWeight: "700" },
  addVersionBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  addVersionText: { color: colors.text, fontSize: typography.sizeSm, fontWeight: "600" },
  ownerBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inviteInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sizeSm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
