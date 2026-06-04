import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteEpub, listEpubs, type EpubMeta } from "@/storage/epubLibrary";
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
// shown as a cover shelf (Calibre-style). Tapping a cover opens the reader;
// on web it downloads, on native it opens the share sheet.
export default function LibraryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<EpubMeta[]>([]);
  const { isDesktop } = useResponsive();
  const numColumns = isDesktop ? 4 : 2;

  useFocusEffect(
    useCallback(() => {
      listEpubs()
        .then(setItems)
        .catch(() => setItems([]));
    }, []),
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteEpub(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
  }, []);

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>Your Library is empty</Text>
        <Text style={styles.emptyBody}>
          Finish a book in the Books tab, then tap “Save to Library (EPUB3)”. Your
          compiled books appear here.
        </Text>
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
      renderItem={({ item }) => (
        <View style={[styles.tile, { maxWidth: `${100 / numColumns}%` }]}>
          <Pressable
            onPress={() => router.push(`/book/read/${item.id}`)}
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
  tile: { flex: 1, marginBottom: spacing.lg, gap: spacing.xs },
  tileTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  tileFooter: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tileMeta: { flex: 1, fontSize: typography.sizeXs, color: colors.textMuted },
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
