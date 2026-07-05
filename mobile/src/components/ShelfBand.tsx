import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ShelfBook } from "@/components/ShelfBook";
import type { EpubMeta } from "@/storage/epubLibrary";
import type { Shelf } from "@/storage/shelfStore";
import { colors, spacing, typography } from "@/constants/theme";

// A shelf hugs the width of the books on it, but never grows past half the screen;
// once the books exceed that, the rack scrolls (with a visible scrollbar). Empty /
// near-empty shelves keep a small minimum so they still read as a shelf.
const MIN_SHELF_WIDTH = 120;

export function ShelfBand({
  shelf,
  books,
  onPressBook,
  onRename,
  onDeleteShelf,
}: {
  shelf: Shelf | null;
  books: EpubMeta[];
  onPressBook: (m: EpubMeta) => void;
  onRename: () => void;
  onDeleteShelf: () => void;
}): React.JSX.Element {
  const name = shelf ? shelf.name : "Unshelved";
  const { width: screenWidth } = useWindowDimensions();
  // RN ScrollViews don't shrink-wrap to their content, so we measure the books'
  // row (onContentSizeChange) and size the viewport from it, clamped to
  // [MIN_SHELF_WIDTH, half the screen]. Below the cap the shelf hugs the books and
  // grows/shrinks with the count; at the cap it stops and the rack scrolls.
  const [contentWidth, setContentWidth] = useState(0);
  const shelfWidth = Math.min(
    Math.max(contentWidth || MIN_SHELF_WIDTH, MIN_SHELF_WIDTH),
    screenWidth * 0.5,
  );

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
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyHint}>No books yet — move some here.</Text>
          <View style={[styles.plank, styles.emptyPlank]} />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          testID="shelf-rack"
          style={[styles.rack, { width: shelfWidth }]}
          contentContainerStyle={styles.rackContent}
          onContentSizeChange={(w) => setContentWidth(w)}
        >
          <View style={styles.rackRow}>
            {books.map((m) => (
              <ShelfBook key={m.id} meta={m} onPress={() => onPressBook(m)} />
            ))}
          </View>
          {/* Warm-wood plank — as wide as the books row it sits under, scrolls with it. */}
          <View style={styles.plank} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  name: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, flexShrink: 1 },
  count: { fontSize: typography.sizeXs, color: colors.textMuted },
  headerActions: { flexDirection: "row", gap: spacing.md, marginLeft: "auto" },
  // The rack viewport hugs the books (up to half-screen); flex-start keeps it left-packed.
  rack: { alignSelf: "flex-start" },
  rackContent: { flexDirection: "column", alignItems: "flex-start" },
  rackRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, minHeight: 132, paddingHorizontal: spacing.xs },
  emptyWrap: { alignSelf: "flex-start" },
  emptyHint: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic", paddingVertical: spacing.lg, paddingHorizontal: spacing.xs },
  emptyPlank: { width: MIN_SHELF_WIDTH },
  plank: {
    height: 12,
    borderRadius: 2,
    backgroundColor: "#5a3d26", // warm wood
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
