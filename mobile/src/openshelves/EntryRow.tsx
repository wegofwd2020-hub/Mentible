// Presentational catalog list item. Plaintext fields only (plan-1 normalized) +
// a scheme-allowlisted cover URL — no HTML, no navigation, no store.
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedEntry } from "./types";

interface Props {
  entry: FeedEntry;
  onPress: (entryId: string) => void;
}

export function EntryRow({ entry, onPress }: Props) {
  const author = entry.authors[0] ?? "Unknown author";
  return (
    <Pressable testID={`entry-${entry.id}`} style={styles.row} onPress={() => onPress(entry.id)}>
      {entry.coverUrl ? (
        <Image source={{ uri: entry.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{author}</Text>
        <Text style={styles.badge}>{entry.mediaType}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "center" },
  cover: { width: 44, height: 60, borderRadius: radius.sm, backgroundColor: colors.border },
  coverPlaceholder: { backgroundColor: colors.borderLight },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  author: { color: colors.textMuted, fontSize: typography.sizeSm },
  badge: { color: colors.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
});
