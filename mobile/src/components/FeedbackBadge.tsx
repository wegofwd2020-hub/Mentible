import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A 💬 comment-count badge for a book that has draft-sharing feedback. Tapping
// it opens that book's feedback; it stops press propagation so it doesn't also
// trigger the row it sits on.
export function FeedbackBadge({ count, onPress }: { count: number; onPress: () => void }): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Feedback: ${count} ${count === 1 ? "comment" : "comments"}`}
      hitSlop={6}
      style={styles.badge}
    >
      <Text style={styles.icon}>💬</Text>
      <Text style={styles.count}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
  },
  icon: { fontSize: typography.sizeXs },
  count: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.growth },
});
