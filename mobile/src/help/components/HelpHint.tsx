import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// A small "?" affordance for non-obvious or destructive controls (SBQ-UI-003):
// tap (or hover on web) to reveal a one-line, plain-language explanation; tap
// again to dismiss. Reusable building block — adopt it next to controls whose
// effect isn't obvious from the label alone, especially destructive ones.
export interface HelpHintProps {
  // The one-line explanation. Keep it short and plain.
  text: string;
  // The control this explains (used to build the accessibility label, e.g.
  // "Help: Delete account").
  label?: string;
}

const SIZE = 22;

export function HelpHint({ text, label }: HelpHintProps) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        onHoverIn={() => setOpen(true)} // web pointer; no-op on native
        onHoverOut={() => setOpen(false)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label ? `Help: ${label}` : "Help"}
        style={styles.badge}
      >
        <Text style={styles.q}>?</Text>
      </Pressable>
      {open ? (
        <View style={styles.bubble} accessibilityLiveRegion="polite" pointerEvents="none">
          <Text style={styles.bubbleText}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { position: "relative" as const, justifyContent: "center" as const },
  badge: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1 as const,
    borderColor: c.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  q: {
    color: c.textSecondary,
    fontSize: typography.sizeSm,
    fontWeight: "700" as const,
    lineHeight: typography.sizeSm + 2,
  },
  bubble: {
    position: "absolute" as const,
    bottom: SIZE + 6,
    right: 0 as const,
    width: 240 as const,
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1 as const,
    borderColor: c.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.3 as const,
    shadowRadius: 12 as const,
    shadowOffset: { width: 0 as const, height: 4 as const },
    elevation: 8 as const,
    zIndex: 10 as const,
  },
  bubbleText: { color: c.text, fontSize: typography.sizeXs, lineHeight: 18 as const },
});
