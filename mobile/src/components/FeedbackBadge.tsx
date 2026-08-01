import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) => ({
  badge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: c.growth,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.growthText,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  icon: { fontSize: typography.sizeXs },
  count: { fontSize: typography.sizeSm, fontWeight: "700" as const, color: c.growthText },
});
