import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BookCover } from "@/components/BookCover";
import { ExportStatusPills } from "@/components/ExportStatusPills";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { BookExportStatus } from "@/storage/exportStatus";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Warm spine palette (shelf visual direction "A" — saturated, bookshelf-real).
const SPINE_PALETTE = ["#c14b3a", "#3a7d55", "#b8892b", "#4a5bbf", "#8a4bb0", "#c07a2b", "#487d8a"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic spine colour + height from the book id, so a book looks the
// same across renders and books on a shelf vary naturally (96–128px tall).
export function spineStyleFor(id: string): { backgroundColor: string; height: number } {
  const h = hashId(id);
  return { backgroundColor: SPINE_PALETTE[h % SPINE_PALETTE.length], height: 96 + (h % 5) * 8 };
}

export function ShelfBook({
  meta,
  expanded,
  reviewCount,
  exportStatus,
  published,
  onPressSpine,
  onRead,
  onReviews,
  onMove,
  onDetails,
  onDelete,
}: {
  meta: EpubMeta;
  expanded: boolean;
  reviewCount?: number;
  exportStatus?: BookExportStatus;
  // Which formats are published to the Open Library (reader-visible availability).
  published?: { epub?: boolean; pdf?: boolean };
  onPressSpine: () => void;
  onRead: () => void;
  onReviews: () => void;
  onMove: () => void;
  onDetails: () => void;
  onDelete: () => void;
}): JSX.Element {
  if (!expanded) {
    const s = spineStyleFor(meta.id);
    return (
      <Pressable
        onPress={onPressSpine}
        accessibilityRole="button"
        accessibilityLabel={`Open: ${meta.title}`}
        style={[styles.spine, { backgroundColor: s.backgroundColor, height: s.height }]}
      >
        <Text style={styles.spineText} numberOfLines={1}>
          {meta.title}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.pulled}>
      <Pressable onPress={onPressSpine} accessibilityRole="button" accessibilityLabel={`Close: ${meta.title}`}>
        <BookCover title={meta.title} coverUri={meta.coverUri} coverSvg={meta.coverSvg} />
      </Pressable>
      <ExportStatusPills status={exportStatus} published={published} />
      <Text style={styles.pulledTitle} numberOfLines={2}>
        {meta.title}
      </Text>
      <View style={styles.actions}>
        <Pressable onPress={onRead} accessibilityRole="button" accessibilityLabel={`Read: ${meta.title}`} style={styles.readBtn}>
          <Text style={styles.readText}>Read</Text>
        </Pressable>
        <Pressable onPress={onReviews} accessibilityRole="button" accessibilityLabel={`Reviews: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.textSecondary} />
          {reviewCount ? <Text style={styles.count}>{reviewCount}</Text> : null}
        </Pressable>
        <Pressable onPress={onMove} accessibilityRole="button" accessibilityLabel={`Move to shelf: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="folder-outline" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={onDetails} accessibilityRole="button" accessibilityLabel={`Details: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete from library: ${meta.title}`} hitSlop={8} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  spine: {
    width: 30,
    borderRadius: 3,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.sm,
    overflow: "hidden",
  },
  spineText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "700",
    // Title runs down the binding.
    transform: [{ rotate: "90deg" }],
    width: 110,
    textAlign: "center",
  },
  pulled: { width: 120, gap: spacing.xs, alignItems: "center" },
  pulledTitle: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.text, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  readBtn: { backgroundColor: colors.brand, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 10 },
  readText: { color: colors.brandText, fontWeight: "700", fontSize: typography.sizeXs },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  count: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
});
