// Catalog for one source (spec P0-1 "view details"). Plaintext entries; tapping
// an entry opens its detail. No downloads here (later plan).
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { EntryRow } from "@/openshelves/EntryRow";

export default function CatalogScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const router = useRouter();
  const cat = useSourceCatalog(sourceId);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>{cat.source?.title ?? "Catalog"}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{cat.entries.length} items</Text>
          <Pressable testID="catalog-refresh" onPress={() => void cat.refresh()} disabled={cat.busy}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        </View>
        {cat.error ? <Text style={styles.error}>{cat.error}</Text> : null}
        {cat.loading && cat.entries.length === 0 ? null : cat.entries.length === 0 ? (
          <Text style={styles.empty}>No items in this catalog.</Text>
        ) : (
          cat.entries.map((e) => (
            <EntryRow key={e.id} entry={e} onPress={(entryId) => router.push(`/shelves/${sourceId}/${entryId}`)} />
          ))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: spacing.md },
  sub: { color: colors.textMuted, fontSize: typography.sizeMd },
  refresh: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
