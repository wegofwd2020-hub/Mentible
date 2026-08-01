// Presentational catalog list item. Plaintext fields only (plan-1 normalized) +
// a scheme-allowlisted cover URL — no HTML, no navigation, no store.
import { Image, Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import type { FeedEntry } from "./types";

interface Props {
  entry: FeedEntry;
  onPress: (entryId: string) => void;
}

export function EntryRow({ entry, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);
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
        {entry.navigationUrl && entry.links.length === 0 ? (
          <Text testID="entry-browse" style={styles.browse}>Browse ›</Text>
        ) : (
          <Text style={styles.badge}>{entry.mediaType}</Text>
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
  row: { flexDirection: "row" as const, gap: spacing.md, paddingVertical: spacing.sm, alignItems: "center" as const },
  cover: { width: 44, height: 60, borderRadius: radius.sm, backgroundColor: c.border },
  coverPlaceholder: { backgroundColor: c.borderLight },
  meta: { flex: 1, minWidth: 0 },
  title: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  author: { color: c.textMuted, fontSize: typography.sizeSm },
  badge: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  browse: { color: c.primary, fontSize: typography.sizeXs, fontWeight: "600" as const, marginTop: 2 },
});
