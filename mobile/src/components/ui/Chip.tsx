import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface Props {
  label: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

// The Studio chip primitive: a small hairline pill. `active` swaps the border
// and text to the accent color; inactive stays muted. No bold weights.
export function Chip({ label, active = false, style }: Props): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.base, active ? styles.active : styles.inactive, style]}>
      <Text style={active ? styles.activeText : styles.inactiveText}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  base: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: "flex-start" as const,
  },
  active: {
    borderColor: c.primary,
    backgroundColor: "transparent" as const,
  },
  inactive: {
    borderColor: c.borderLight,
    backgroundColor: "transparent" as const,
  },
  activeText: {
    color: c.primary,
    fontWeight: "500" as const,
    fontSize: typography.sizeXs,
  },
  inactiveText: {
    color: c.textMuted,
    fontWeight: "500" as const,
    fontSize: typography.sizeXs,
  },
});
