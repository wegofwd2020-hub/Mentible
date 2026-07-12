// Entry detail route: loads the entry from the source catalog + opens its source
// link via Linking (canonicalUrl is scheme-allowlisted in plan 1, so this is safe).
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { EntryDetail } from "@/openshelves/EntryDetail";

export default function EntryDetailScreen() {
  const { sourceId, entryId } = useLocalSearchParams<{ sourceId: string; entryId: string }>();
  const cat = useSourceCatalog(sourceId);
  const entry = cat.entries.find((e) => e.id === entryId) ?? null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        {entry ? (
          <EntryDetail
            entry={entry}
            sourceTitle={cat.source?.title ?? cat.source?.url ?? "Unknown source"}
            onViewAtSource={(url) => { void Linking.openURL(url); }}
          />
        ) : (
          <Text style={styles.missing}>{cat.loading ? "Loading…" : "Entry not found."}</Text>
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  missing: { color: colors.textMuted, marginTop: spacing.lg },
});
