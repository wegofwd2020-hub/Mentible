import React from "react";
import { Pressable, Text, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface Props {
  variant: "primary" | "ghost";
  label: string;
  onPress: () => void;
  busy?: boolean;
  /** Text shown in place of `label` while `busy` — defaults to "…". Use for a
   *  long-running action (e.g. an EPUB compile) where a bare ellipsis doesn't
   *  read as in-progress. */
  busyLabel?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

// The Studio button primitive. `primary` is a solid gold pill (the one bold
// fill in the language); `ghost` is a hairline pill with a transparent fill —
// there is no third, bolder variant. Text is always medium weight (500), never
// bold (700), per the Studio "no bold weights" rule.
export function Button({
  variant,
  label,
  onPress,
  busy = false,
  busyLabel = "…",
  disabled = false,
  accessibilityLabel,
  style,
}: Props): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || busy;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={[
        styles.base,
        variant === "primary" ? styles.primary : styles.ghost,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <Text style={variant === "primary" ? styles.primaryText : styles.ghostText}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
  base: {
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  primary: {
    backgroundColor: c.primary,
  },
  ghost: {
    backgroundColor: "transparent" as const,
    borderWidth: 1,
    borderColor: c.borderLight,
  },
  disabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: c.primaryText,
    fontWeight: "500" as const,
    fontSize: typography.sizeMd,
  },
  ghostText: {
    color: c.text,
    fontWeight: "500" as const,
    fontSize: typography.sizeMd,
  },
});
