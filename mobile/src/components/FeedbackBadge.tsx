import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A prominent 💬 comment-count badge for a book that has draft-sharing feedback.
// Overlaid on the book cover (positioned by the caller via `style`). Tapping it
// opens that book's feedback; it stops press propagation so it doesn't also
// trigger the cover/row it sits on.
export function FeedbackBadge({
  count,
  onPress,
  style,
}: {
  count: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Feedback: ${count} ${count === 1 ? "comment" : "comments"}`}
      hitSlop={8}
      style={[styles.badge, style]}
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
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.growth,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.growthText,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  icon: { fontSize: typography.sizeXs },
  count: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.growthText },
});
