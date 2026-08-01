// Presentational row for one subscribed source (spec P0-1). Title/url, entry
// count, last-refreshed, and Refresh/Remove buttons. The screen owns any confirm.
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import type { FeedSource } from "./types";

interface Props {
  source: FeedSource;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen?: (id: string) => void;
  busy?: boolean;
}

export function SourceRow({ source, onRefresh, onRemove, onOpen, busy }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { id, title, url, entryCount, lastRefreshedAt, isStarter } = source;
  return (
    <View style={styles.row}>
      <Pressable testID={`open-${id}`} style={styles.meta} onPress={() => onOpen?.(id)}>
        <Text style={styles.title} numberOfLines={1}>{title ?? url}</Text>
        {isStarter ? <Text style={styles.badge}>Curated by Mentible</Text> : null}
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

const makeStyles = (c: Palette) => ({
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, paddingVertical: spacing.sm },
  meta: { flex: 1, minWidth: 0 },
  title: { color: c.text, fontSize: typography.sizeMd },
  badge: { color: c.primary, fontSize: typography.sizeXs, fontWeight: "600" as const },
  sub: { color: c.textMuted, fontSize: typography.sizeXs },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  actionText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "600" as const },
  removeText: { color: c.error },
});
