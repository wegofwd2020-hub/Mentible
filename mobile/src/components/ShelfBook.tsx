import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { EpubMeta } from "@/storage/epubLibrary";
import { colors, spacing } from "@/constants/theme";

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

// A book on a shelf: just the spine. Tapping it opens the metadata sidebar
// (BookMetadataModal), which carries the cover-less detail view + actions.
export function ShelfBook({ meta, onPress }: { meta: EpubMeta; onPress: () => void }): React.JSX.Element {
  const s = spineStyleFor(meta.id);
  return (
    <Pressable
      onPress={onPress}
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
});
