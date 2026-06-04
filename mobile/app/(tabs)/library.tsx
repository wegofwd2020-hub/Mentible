import React, { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteEpub, listEpubs, openEpub, saveEpub, type EpubMeta } from "@/storage/epubLibrary";
import { pickEpubFile } from "@/storage/pickBookFile";
import { BookCover } from "@/components/BookCover";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { colors, radius, spacing, typography } from "@/constants/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The Library: finished books compiled to EPUB3 and stored on this device,
// shown as a cover shelf (Calibre-style). Authored books open in the in-app
// reader; imported EPUBs (no book.json) open via the OS share sheet. Any EPUB
// can be added with "Import EPUB".
export default function LibraryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<EpubMeta[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isDesktop } = useResponsive();
  const numColumns = isDesktop ? 4 : 2;

  const reload = useCallback(() => {
    listEpubs()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useFocusEffect(useCallback(() => reload(), [reload]));

  const handleDelete = useCallback(async (id: string) => {
    await deleteEpub(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleImport = useCallback(async () => {
    setError(null);
    setImporting(true);
    try {
      const picked = await pickEpubFile();
      if (!picked) return; // cancelled
      const head = new Uint8Array(picked.bytes.slice(0, 2));
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
        throw new Error("That doesn't look like an EPUB (zip) file.");
      }
      const title = picked.name.replace(/\.epub$/i, "").trim() || "Imported book";
      const slug =
        title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "epub";
      await saveEpub({ bookId: `imported-${slug}`, title, bytes: picked.bytes });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that file.");
    } finally {
      setImporting(false);
    }
  }, [reload]);

  const openItem = useCallback(
    (item: EpubMeta) => {
      // Imported EPUBs have no in-app book.json → share/open externally;
      // authored books open in the in-app reader.
      if (item.id.startsWith("imported-")) {
        openEpub(item.id, item.title).catch((e) =>
          Alert.alert("Couldn't open", e instanceof Error ? e.message : String(e)),
        );
      } else {
        router.push(`/book/read/${item.id}`);
      }
    },
    [router],
  );

  const importButton = (
    <Pressable
      style={[styles.importBtn, importing && styles.importBtnDisabled]}
      onPress={handleImport}
      disabled={importing}
      accessibilityRole="button"
      accessibilityLabel="Import an EPUB file into your library"
    >
      <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
      <Text style={styles.importBtnText}>{importing ? "Importing…" : "Import EPUB"}</Text>
    </Pressable>
  );

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>Your Library is empty</Text>
        <Text style={styles.emptyBody}>
          Finish a book in the Books tab and tap “Save to Library”, or import an EPUB
          you already have.
        </Text>
        {importButton}
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/books")}
          accessibilityRole="button"
          accessibilityLabel="Go to Books"
        >
          <Text style={styles.ctaText}>Go to Books →</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      key={numColumns}
      style={styles.list}
      contentContainerStyle={[styles.gridContent, isDesktop && styles.gridWide]}
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={numColumns}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={
        <View style={styles.header}>
          {importButton}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.tile, { maxWidth: `${100 / numColumns}%` }]}>
          <Pressable
            onPress={() => openItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open book: ${item.title}`}
          >
            <BookCover title={item.title} badge="EPUB3" coverUri={item.coverUri} />
          </Pressable>
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.tileFooter}>
            <Text style={styles.tileMeta} numberOfLines={1}>
              {formatSize(item.sizeBytes)} · {formatDate(item.compiledAt)}
            </Text>
            <Pressable
              onPress={() => handleDelete(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Delete from library: ${item.title}`}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  gridContent: { padding: spacing.md },
  gridWide: { maxWidth: MAX_WIDE_WIDTH, width: "100%", alignSelf: "center" },
  gridRow: { gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.md },
  tile: { flex: 1, marginBottom: spacing.lg, gap: spacing.xs },
  tileTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  tileFooter: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tileMeta: { flex: 1, fontSize: typography.sizeXs, color: colors.textMuted },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary + "1A",
  },
  importBtnDisabled: { opacity: 0.6 },
  importBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  errorText: { color: colors.error, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  empty: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 300,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  ctaText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
