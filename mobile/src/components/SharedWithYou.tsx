import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { sharedWithMe, type SharedItem } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// Library-tab section listing drafts other authors shared with the signed-in
// user (ADR-027 D2–D4). Self-hides when signed out or empty; refetches on focus.
// Tapping a draft opens the full-screen reader (/book/shared/[id]).
export function SharedWithYou({ token }: { token: string | null }): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState<SharedItem[]>([]);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!token) {
          setItems([]);
          return;
        }
        try {
          setItems(await sharedWithMe(token));
        } catch {
          setItems([]);
        }
      })();
    }, [token]),
  );

  if (!token || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Shared with you</Text>
      {items.map((it) => (
        <Pressable
          key={it.book_id}
          onPress={() => router.push(`/book/shared/${it.book_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open shared draft: ${it.title}`}
          style={styles.item}
        >
          <Text style={styles.itemTitle} numberOfLines={1}>
            {it.title}
          </Text>
          <Text style={styles.itemMeta}>v{it.version}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700" as const, color: c.text },
  item: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, padding: spacing.sm, borderWidth: 1, borderColor: c.border, borderRadius: radius.md },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700" as const, color: c.text, flexShrink: 1 },
  itemMeta: { fontSize: typography.sizeXs, color: c.textMuted },
});
