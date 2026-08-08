import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getTopicVersion, type TopicVersionDetailView } from "@/api/trustClient";
import { ApiError } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { PLAYFAIR } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card, Label } from "@/components/ui";

type Styles = ReturnType<typeof makeStyles>;

// Read-only viewer for a single per-topic draft version (Slice C2b). No
// editing, feedback, regenerate, or approve here — per-topic validation is
// C2c. This mirrors trust/version/[versionId].tsx's data-load + layout shape
// but strips every action down to just rendering the content.
function TopicVersionViewerInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const [topicVersion, setTopicVersion] = useState<TopicVersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

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
});
