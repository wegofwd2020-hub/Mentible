import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useReviews } from "@/hooks/useReviews";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { SmeThemeScope, useTheme, useThemedStyles } from "@/theme";

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
        <Text style={styles.empty}>No projects to review yet.</Text>
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
  // SME surface → always the Navy Trust brand (ADR-038). Scope wraps the content
  // (not the sign-in gate) so ReviewsInner's useThemedStyles resolves navy-trust.
  return (
    <RequireSignIn action="review projects">
      <SmeThemeScope>
        <PageContainer>
          <ReviewsInner />
        </PageContainer>
      </SmeThemeScope>
    </RequireSignIn>
  );
}

const makeStyles = (c: Palette) => ({
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row" as const, alignItems: "center" as const, backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  rowTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold },
  rowMeta: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const },
});
