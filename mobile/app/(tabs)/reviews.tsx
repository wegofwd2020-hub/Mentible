import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useReviews } from "@/hooks/useReviews";
import { colors, radius, spacing, typography } from "@/constants/theme";

function ReviewsInner() {
  const router = useRouter();
  const { reviews, loading, error } = useReviews();

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
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
  return (
    <RequireSignIn action="review projects">
      <PageContainer>
        <ReviewsInner />
      </PageContainer>
    </RequireSignIn>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  rowMeta: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  empty: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  emptySub: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
