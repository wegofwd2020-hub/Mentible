import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getTopicVersion, type TopicVersionDetailView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { Alert } from "@/lib/alert";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { PLAYFAIR } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card, Label, Button } from "@/components/ui";

type Styles = ReturnType<typeof makeStyles>;

// Read-write viewer for a single per-topic draft version (Slice C2c). Adds
// Approve/Withdraw to the C2b read-only viewer, mirroring
// trust/version/[versionId].tsx's approve/withdraw shape: an owner reveals a
// name field (operator-recorded); a reviewer approves in one tap
// (expert_self); a validated version offers Withdraw behind a confirm.
function TopicVersionViewerInner() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { project, approveTopic, withdrawTopic } = useTrustProject(String(projectId));
  const [topicVersion, setTopicVersion] = useState<TopicVersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apBusy, setApBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [expertName, setExpertName] = useState("");
  const isOwner = project?.my_role === "owner";

  // Re-fetch just this version (used after approve/withdraw so the header's
  // validated state reflects the append-only toggle).
  const reload = useCallback(async () => {
    if (!accessToken) return;
    const v = await getTopicVersion(String(id), accessToken);
    setTopicVersion(v);
  }, [accessToken, id]);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    void (async () => {
      try {
        const v = await getTopicVersion(String(id), accessToken);
        if (live) setTopicVersion(v);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.userMessage() : "This draft no longer exists.");
      }
    })();
    return () => { live = false; };
  }, [accessToken, id]);

  // Reviewers self-approve in one tap (expert_self). An owner records on a named
  // expert's behalf (operator) — tapping Approve reveals a name field first.
  const runApprove = (opts?: { expertName: string }) => {
    setApBusy(true);
    void (async () => {
      try {
        const ap = opts ? await approveTopic(String(id), opts) : await approveTopic(String(id));
        setAskName(false);
        setExpertName("");
        // Approval is committed; a failed header refresh must not read as a
        // failed approval, so the reload is best-effort.
        await reload().catch(() => {});
        Alert.alert(
          "Approved",
          ap.recorded_via === "expert_self" ? "Recorded as expert-validated." : `Recorded as validated by ${ap.expert_name}.`,
        );
      } catch (e) {
        Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setApBusy(false);
      }
    })();
  };

  const onApprove = () => {
    if (isOwner) { setAskName(true); return; }
    runApprove();
  };

  const submitOwnerApprove = () => {
    const name = expertName.trim();
    if (name) runApprove({ expertName: name });
  };

  const onUnapprove = () => {
    Alert.alert(
      "Withdraw approval",
      `Withdraw the approval on v${topicVersion?.version_no}? This is recorded; the topic returns to awaiting review.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            setApBusy(true);
            void (async () => {
              try {
                await withdrawTopic(String(id));
                // Withdrawal is committed; the reload is best-effort (see runApprove).
                await reload().catch(() => {});
              } catch (e) {
                Alert.alert("Couldn't withdraw", e instanceof ApiError ? e.userMessage() : "Please try again.");
              } finally {
                setApBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!topicVersion) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{topicVersion.title}</Text>
          {topicVersion.is_validated ? (
            <View style={styles.badgeRow}>
              <Text accessibilityLabel={`${topicVersion.title} validated`} style={styles.chip}>Validated ✓</Text>
              {topicVersion.recorded_via === "expert_self" ? (
                <Text style={styles.provChip}>expert-validated</Text>
              ) : topicVersion.recorded_via === "operator" ? (
                <Text style={styles.provChip}>operator-recorded</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {(topicVersion.content?.sections ?? []).map((s, i) => (
          <Card key={i} style={styles.section}>
            <Label>{s.heading}</Label>
            <Text style={styles.bodyText}>{s.body}</Text>
          </Card>
        ))}
        <View style={styles.actionsRow}>
          {topicVersion.is_validated ? (
            <Button
              variant="ghost"
              label="Withdraw"
              accessibilityLabel={`Withdraw approval of version ${topicVersion.version_no}`}
              busy={apBusy}
              onPress={onUnapprove}
            />
          ) : (
            <Button
              variant="primary"
              label="Approve"
              accessibilityLabel={`Approve version ${topicVersion.version_no}`}
              busy={apBusy}
              onPress={onApprove}
            />
          )}
        </View>
        {askName ? (
          <Card style={styles.editRow}>
            <Text style={styles.bodyText}>Record this version as validated by an expert. Enter their name — it&apos;s logged as operator-recorded by you.</Text>
            <TextInput
              style={styles.input}
              value={expertName}
              onChangeText={setExpertName}
              accessibilityLabel="Expert name"
              placeholder="Expert's name"
              autoCapitalize="words"
            />
            <Button
              variant="primary"
              label="Record approval"
              accessibilityLabel="Record approval"
              busy={apBusy}
              disabled={!expertName.trim()}
              onPress={submitOwnerApprove}
            />
          </Card>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

export default function TopicVersionViewer() {
  return <TopicVersionViewerInner />;
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: c.background },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: PLAYFAIR.bold, letterSpacing: -0.56 },
  badgeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  chip: { color: c.primaryText, backgroundColor: c.primary, fontSize: typography.sizeSm, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  provChip: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  section: { gap: spacing.sm },
  bodyText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm },
  backText: { color: c.primary, fontSize: typography.sizeMd },
  actionsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.sm },
  editRow: { gap: spacing.sm },
  input: { color: c.text, fontSize: typography.sizeMd, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.sm },
});
