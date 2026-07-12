// Presentational row for one subscribed source (spec P0-1). Title/url, entry
// count, last-refreshed, and Refresh/Remove buttons. The screen owns any confirm.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedSource } from "./types";

interface Props {
  source: FeedSource;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen?: (id: string) => void;
  busy?: boolean;
}

export function SourceRow({ source, onRefresh, onRemove, onOpen, busy }: Props) {
  const { id, title, url, entryCount, lastRefreshedAt } = source;
  return (
    <View style={styles.row}>
      <Pressable testID={`open-${id}`} style={styles.meta} onPress={() => onOpen?.(id)}>
        <Text style={styles.title} numberOfLines={1}>{title ?? url}</Text>
        <Text style={styles.sub}>
          {entryCount} items · Last refreshed: {lastRefreshedAt ?? "Never"}
        </Text>
      </Pressable>
      <Pressable testID={`refresh-${id}`} style={styles.action} onPress={() => onRefresh(id)} disabled={busy}>
        <Text style={styles.actionText}>Refresh</Text>
      </Pressable>
      <Pressable testID={`remove-${id}`} style={styles.action} onPress={() => onRemove(id)} disabled={busy}>
        <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: typography.sizeMd },
  sub: { color: colors.textMuted, fontSize: typography.sizeXs },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  actionText: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  removeText: { color: colors.error },
});
