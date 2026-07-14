// Catalog for one source (spec P0-1 "view details"). Plaintext entries; tapping
// a leaf entry opens its detail. A navigation entry drills into its sub-feed
// in place (OPDS catalogs are a tree — Task 3's useFeedBrowser fetches the
// sub-feed on demand; those entries are transient and never written to the
// store). No downloads here (later plan).
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { useFeedBrowser } from "@/openshelves/useFeedBrowser";
import { EntryRow } from "@/openshelves/EntryRow";

export default function CatalogScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const router = useRouter();
  const cat = useSourceCatalog(sourceId);

  const root = useMemo(
    () => ({ title: cat.source?.title ?? "Catalog", url: cat.source?.url ?? "", entries: cat.entries }),
    [cat.source?.title, cat.source?.url, cat.entries],
  );
  const browser = useFeedBrowser(root);
  const shown = browser.frame.entries;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>{browser.frame.title}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{shown.length} items</Text>
          {browser.canGoBack ? (
            <Pressable testID="browse-back" onPress={browser.back}><Text style={styles.back}>‹ Back</Text></Pressable>
          ) : null}
        </View>
        {browser.error ? <Text style={styles.error}>{browser.error}</Text> : null}
        {cat.loading && shown.length === 0 ? null : shown.length === 0 ? (
          <Text style={styles.empty}>No items in this catalog.</Text>
        ) : (
          shown.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onPress={() => {
                if (e.navigationUrl && e.links.length === 0) void browser.enter(e);
                else router.push(`/shelves/${sourceId}/${e.id}`);
              }}
            />
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
  back: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
