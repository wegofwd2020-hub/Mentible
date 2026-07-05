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

// Spine height spans 96–128px over an EPUB-size range of ~50KB … 5MB.
const MIN_BYTES = 50 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 128;

// Spine appearance: colour is a deterministic hash of the book id (so a book
// keeps the same colour across renders), while HEIGHT reflects the book's length
// via its compiled EPUB size — bigger file → more content → taller spine. A log
// scale spreads sizes that span orders of magnitude, and the result is clamped to
// 96–128px. Size 0 / tiny → shortest; ≥5MB → tallest.
export function spineStyleFor(id: string, sizeBytes: number): { backgroundColor: string; height: number } {
  const backgroundColor = SPINE_PALETTE[hashId(id) % SPINE_PALETTE.length];
  const lnMin = Math.log(MIN_BYTES);
  const lnMax = Math.log(MAX_BYTES);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(sizeBytes, 1)) - lnMin) / (lnMax - lnMin)));
  const height = MIN_HEIGHT + Math.round((MAX_HEIGHT - MIN_HEIGHT) * t);
  return { backgroundColor, height };
}

// A book on a shelf: just the spine. Tapping it opens the metadata sidebar
// (BookMetadataModal), which carries the cover-less detail view + actions.
export function ShelfBook({ meta, onPress }: { meta: EpubMeta; onPress: () => void }): React.JSX.Element {
  const s = spineStyleFor(meta.id, meta.sizeBytes);
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
