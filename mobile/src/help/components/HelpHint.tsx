import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

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

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center" },
  badge: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  q: {
    color: colors.textSecondary,
    fontSize: typography.sizeSm,
    fontWeight: "700",
    lineHeight: typography.sizeSm + 2,
  },
  // Floats above the "?" and aligns to the right edge so it stays on-screen.
  bubble: {
    position: "absolute",
    bottom: SIZE + 6,
    right: 0,
    width: 240,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 10,
  },
  bubbleText: { color: colors.text, fontSize: typography.sizeXs, lineHeight: 18 },
});
