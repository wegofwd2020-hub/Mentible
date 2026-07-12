// Presentational entry detail with provenance (spec P0-7). Plaintext fields; the
// screen owns loading + opening the source link. Rights are surfaced verbatim and
// "Not stated by source" when absent — never fabricated.
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedEntry } from "./types";

interface Props {
  entry: FeedEntry;
  sourceTitle: string;
  onViewAtSource: (url: string) => void;
}

export function EntryDetail({ entry, sourceTitle, onViewAtSource }: Props) {
  return (
    <View style={styles.wrap}>
      {entry.coverUrl ? (
        <Image source={{ uri: entry.coverUrl }} style={styles.cover} resizeMode="contain" />
      ) : null}
      <Text style={styles.title}>{entry.title}</Text>
      {entry.authors.length > 0 ? <Text style={styles.author}>{entry.authors.join(", ")}</Text> : null}
      <Text style={styles.badge}>{entry.mediaType}</Text>
      {entry.summary ? <Text style={styles.summary}>{entry.summary}</Text> : null}

      <View style={styles.provenance}>
        <Text style={styles.provTitle}>Provenance</Text>
        <Text style={styles.provLine}>Source: {sourceTitle}</Text>
        <Text style={styles.provLine}>Rights: {entry.rightsText ?? "Not stated by source"}</Text>
        {entry.canonicalUrl ? (
          <Pressable testID="view-at-source" style={styles.button} onPress={() => onViewAtSource(entry.canonicalUrl as string)}>
            <Text style={styles.buttonText}>View at source</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  cover: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  author: { color: colors.textMuted, fontSize: typography.sizeMd },
  badge: { color: colors.textMuted, fontSize: typography.sizeXs },
  summary: { color: colors.text, fontSize: typography.sizeMd, marginTop: spacing.sm },
  provenance: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  provTitle: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  provLine: { color: colors.textMuted, fontSize: typography.sizeSm },
  button: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  buttonText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "600" },
});
