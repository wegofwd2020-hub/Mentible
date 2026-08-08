import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// The Studio surface primitive: a hairline-bordered card, no shadow, no bold
// fill — the surface reads by its 1px border, not by elevation.
export function Card({ children, style }: Props): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.base, style]}>{children}</View>;
}

const makeStyles = (c: Palette) => ({
  base: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
