import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface Props {
  children: React.ReactNode;
  tone?: "muted" | "secondary";
  style?: StyleProp<TextStyle>;
}

// The Studio caption/eyebrow primitive: small, uppercase, letter-spaced text —
// never bold. Used for field labels, section eyebrows, and metadata captions
// across the re-skinned surfaces.
export function Label({ children, tone = "muted", style }: Props): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.base, tone === "secondary" ? styles.secondary : styles.muted, style]}>{children}</Text>;
}

const makeStyles = (c: Palette) => ({
  base: {
    textTransform: "uppercase" as const,
    letterSpacing: Math.round(typography.sizeXs * 0.14),
    fontWeight: "500" as const,
    fontSize: typography.sizeXs,
  },
  muted: { color: c.textMuted },
  secondary: { color: c.textSecondary },
});
