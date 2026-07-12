// mobile/app/(tabs)/shelves.tsx
// Open Shelves — Sources management (spec P0-1). Add a free book repo by URL,
// list/refresh/remove sources. User-added sources are warned (P0-8, neutral
// conduit) and never blocked. No auth required.
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Alert } from "@/lib/alert";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useOpenShelves } from "@/openshelves/useOpenShelves";
import { AddSourceForm } from "@/openshelves/AddSourceForm";
import { SourceRow } from "@/openshelves/SourceRow";

const WARNING =
  "This library is outside Mentible's curation. You're responsible for the content you add and read. Add it?";

export default function ShelvesScreen() {
  const shelves = useOpenShelves();
  const router = useRouter();

  const confirmAdd = (url: string) => {
    Alert.alert("Add this source?", WARNING, [
      { text: "Cancel", style: "cancel" },
      { text: "Add", onPress: () => { void shelves.add(url); } },
    ]);
  };

  const confirmRemove = (id: string) => {
    Alert.alert("Remove source?", "Its catalog entries will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void shelves.remove(id); } },
    ]);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.heading}>Open Shelves</Text>
        <Text style={styles.blurb}>Browse free book catalogs (OPDS). Add a repo by URL.</Text>

        <AddSourceForm onSubmit={confirmAdd} busy={shelves.busy} error={shelves.error} />

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Sources</Text>
          {shelves.sources.length > 0 ? (
            <Pressable testID="refresh-all" onPress={() => void shelves.refreshAllSources()} disabled={shelves.busy}>
              <Text style={styles.refreshAll}>Refresh all</Text>
            </Pressable>
          ) : null}
        </View>

        {shelves.loading && shelves.sources.length === 0 ? null : shelves.sources.length === 0 ? (
          <Text style={styles.empty}>No sources yet. Add an OPDS catalog URL above.</Text>
        ) : (
          shelves.sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              busy={shelves.busy}
              onRefresh={shelves.refresh}
              onRemove={confirmRemove}
              onOpen={(id) => router.push(`/shelves/${id}`)}
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
  heading: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700", marginBottom: spacing.xs },
  blurb: { color: colors.textMuted, fontSize: typography.sizeMd, marginBottom: spacing.lg },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: typography.sizeXl, fontWeight: "600" },
  refreshAll: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
