import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ShelfBook } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { BookExportStatus } from "@/storage/exportStatus";
import type { PublishedFormats } from "@/lib/trackedExport";
import type { Shelf } from "@/storage/shelfStore";
import { colors, spacing, typography } from "@/constants/theme";

export function ShelfBand({
  shelf,
  books,
  expandedId,
  counts,
  exportStatus,
  published,
  onExpand,
  onRead,
  onReviews,
  onMove,
  onDetails,
  onDelete,
  onRename,
  onDeleteShelf,
}: {
  shelf: Shelf | null;
  books: EpubMeta[];
  expandedId: string | null;
  counts: Record<string, number>;
  exportStatus: Record<string, BookExportStatus>;
  // Which formats are published to the Open Library, keyed by book id.
  published: Record<string, PublishedFormats>;
  onExpand: (bookId: string | null) => void;
  onRead: (m: EpubMeta) => void;
  onReviews: (m: EpubMeta) => void;
  onMove: (m: EpubMeta) => void;
  onDetails: (m: EpubMeta) => void;
  onDelete: (m: EpubMeta) => void;
  onRename: () => void;
  onDeleteShelf: () => void;
}): JSX.Element {
  const name = shelf ? shelf.name : "Unshelved";
  return (
    <View style={styles.band}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.count}>
          {books.length} {books.length === 1 ? "book" : "books"}
        </Text>
        {shelf ? (
          <View style={styles.headerActions}>
            <Pressable onPress={onRename} accessibilityRole="button" accessibilityLabel={`Rename shelf: ${name}`} hitSlop={8}>
              <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={onDeleteShelf} accessibilityRole="button" accessibilityLabel={`Delete shelf: ${name}`} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {books.length === 0 ? (
        <Text style={styles.emptyHint}>No books yet — move some here.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rack}>
          {books.map((m) => (
            <ShelfBook
              key={m.id}
              meta={m}
              expanded={expandedId === m.id}
              reviewCount={counts[m.id]}
              exportStatus={exportStatus[m.id]}
              published={published[m.id]}
              onPressSpine={() => onExpand(expandedId === m.id ? null : m.id)}
              onRead={() => onRead(m)}
              onReviews={() => onReviews(m)}
              onMove={() => onMove(m)}
              onDetails={() => onDetails(m)}
              onDelete={() => onDelete(m)}
            />
          ))}
        </ScrollView>
      )}

      {/* Warm-wood plank the spines rest on. */}
      <View style={styles.plank} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: { marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  name: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, flexShrink: 1 },
  count: { fontSize: typography.sizeXs, color: colors.textMuted },
  headerActions: { flexDirection: "row", gap: spacing.md, marginLeft: "auto" },
  rack: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, minHeight: 132, paddingHorizontal: spacing.xs },
  emptyHint: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic", paddingVertical: spacing.lg, paddingHorizontal: spacing.xs },
  plank: {
    height: 12,
    borderRadius: 2,
    backgroundColor: "#5a3d26", // warm wood
    marginHorizontal: -spacing.xs,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
