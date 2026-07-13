import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Alert } from "@/lib/alert";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useDownloads } from "@/openshelves/useDownloads";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const dl = useDownloads();

  const confirmDelete = (entryId: string, title: string) =>
    Alert.alert("Delete download?", `Remove "${title}" from this device?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void dl.remove(entryId); } },
    ]);

  const confirmDeleteAll = () =>
    Alert.alert("Delete all downloads?", "Remove every downloaded item from this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: () => { void dl.removeAll(); } },
    ]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>Downloads</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{dl.items.length} {dl.items.length === 1 ? "item" : "items"} · {mb(dl.total)}</Text>
          {dl.items.length > 0 ? (
            <Pressable testID="del-all" onPress={confirmDeleteAll}><Text style={styles.delAll}>Delete all</Text></Pressable>
          ) : null}
        </View>
        {dl.loading && dl.items.length === 0 ? null : dl.items.length === 0 ? (
          <Text style={styles.empty}>No downloads yet. Download a book from a catalog entry.</Text>
        ) : (
          dl.items.map((d) => (
            <View key={d.entryId} style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.itemTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.itemSub}>{mb(d.bytes)}</Text>
              </View>
              <Pressable testID={`del-${d.entryId}`} onPress={() => confirmDelete(d.entryId, d.title)}>
                <Text style={styles.del}>Delete</Text>
              </Pressable>
            </View>
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
  delAll: { color: colors.error, fontSize: typography.sizeMd, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  meta: { flex: 1, minWidth: 0 },
  itemTitle: { color: colors.text, fontSize: typography.sizeMd },
  itemSub: { color: colors.textMuted, fontSize: typography.sizeSm },
  del: { color: colors.error, fontSize: typography.sizeMd, fontWeight: "600" },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
