import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { sharedWithMe, type SharedItem } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Library-tab section listing drafts other authors shared with the signed-in
// user (ADR-027 D2–D4). Self-hides when signed out or empty; refetches on focus.
// Tapping a draft opens the full-screen reader (/book/shared/[id]).
export function SharedWithYou({ token }: { token: string | null }): React.JSX.Element | null {
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

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  header: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  itemTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text, flexShrink: 1 },
  itemMeta: { fontSize: typography.sizeXs, color: colors.textMuted },
});
