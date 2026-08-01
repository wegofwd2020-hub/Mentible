import { useState } from "react";
import { ScrollView, Text, View, Pressable, Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import { Alert } from "@/lib/alert";
import { PageContainer } from "@/components/PageContainer";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { useDownloads } from "@/openshelves/useDownloads";
import { importEpub } from "@/openshelves/importEpub";
import { fromBase64 } from "@/storage/pickBookFile";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const dl = useDownloads();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

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

  async function open(rec: { entryId: string; title: string; path: string }) {
    setOpenError(null);
    setOpening(rec.entryId);
    try {
      const b64 = await FileSystem.readAsStringAsync(rec.path, { encoding: FileSystem.EncodingType.Base64 });
      const book = await importEpub(new Uint8Array(fromBase64(b64)));
      router.push(`/book/read/${book.id}`);
    } catch (e) {
      // Import failures are specific and actionable ("copy-protected", "too large").
      // Show them — a silent failure on a book the user chose to open is the worst
      // outcome.
      setOpenError(e instanceof Error ? e.message : "Couldn't open that book.");
    } finally {
      setOpening(null);
    }
  }

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
              {Platform.OS !== "web" && d.mimeType === "application/epub+zip" && (
                <Pressable
                  onPress={() => open(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${d.title}`}
                  disabled={opening === d.entryId}
                >
                  <Text style={styles.openBtn}>{opening === d.entryId ? "Opening…" : "Open"}</Text>
                </Pressable>
              )}
              <Pressable testID={`del-${d.entryId}`} onPress={() => confirmDelete(d.entryId, d.title)}>
                <Text style={styles.del}>Delete</Text>
              </Pressable>
            </View>
          ))
        )}
        {openError && <Text style={styles.error}>{openError}</Text>}
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: c.background },
  content: { paddingVertical: spacing.lg },
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  headerRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginVertical: spacing.md },
  sub: { color: c.textMuted, fontSize: typography.sizeMd },
  delAll: { color: c.error, fontSize: typography.sizeMd, fontWeight: "600" as const },
  row: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingVertical: spacing.sm, gap: spacing.sm },
  meta: { flex: 1 as const, minWidth: 0 },
  itemTitle: { color: c.text, fontSize: typography.sizeMd },
  itemSub: { color: c.textMuted, fontSize: typography.sizeSm },
  openBtn: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "600" as const },
  del: { color: c.error, fontSize: typography.sizeMd, fontWeight: "600" as const },
  empty: { color: c.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
  error: { color: c.error, fontSize: typography.sizeMd, marginTop: spacing.md },
});
