import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { AccentText } from "@/components/AccentText";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useReviews } from "@/hooks/useReviews";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";

function ReviewsInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { reviews, loading, error, refresh } = useReviews();

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (reviews.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No projects to <AccentText>review</AccentText> yet.</Text>
        <Text style={styles.emptySub}>When an expert invites you, the project appears here.</Text>
      </View>
    );
  }
  return (
    <FlatList
      data={reviews}
      keyExtractor={(r) => r.projectId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open project: ${item.title}`}
          style={styles.row}
          onPress={() => router.push(`/trust/${item.projectId}`)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowMeta}>{item.versionsValidated}/{item.versionsTotal} versions validated</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

export default function ReviewsScreen() {
  // Follows the user's selected theme (ADR-038 O1 reversed — trust surfaces no
  // longer force the Navy Trust brand).
  return (
    <RequireSignIn action="review projects">
      {/* flex:1 so the FlatList/centered-empty (flex:1) has a bounded parent —
          without it the content collapses to 0 height on native (New Arch). */}
      <PageContainer style={{ flex: 1 }}>
        <ReviewsInner />
      </PageContainer>
    </RequireSignIn>
  );
}

const makeStyles = (c: Palette) => ({
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  rowTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  rowMeta: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
});
