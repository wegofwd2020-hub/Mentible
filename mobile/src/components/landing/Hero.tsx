import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { AccentText } from "@/components/AccentText";
import { goToAnchor } from "@/components/navState";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { radius, spacing, typography, type Palette } from "@/constants/theme";

const STATS: Array<[string, string]> = [
  ["Weeks, not months", "one focused sprint"],
  ["1 source", "book + derivatives"],
  ["Named-expert sign-off", "recorded on each version"],
];

export function Hero(): React.JSX.Element {
  const s = useThemedStyles(make);
  const router = useRouter();
  return (
    <View style={s.hero}>
      <Text style={s.h1}>
        Turn expertise into <AccentText>trusted knowledge.</AccentText>
      </Text>
      <Text style={s.sub}>
        Expert-validated books, guides, and social content — drafted by AI from your own
        sources, every claim cited back to one, then reviewed and signed off by a named
        expert.
      </Text>
      <View style={s.ctas}>
        <Pressable
          accessibilityRole="button"
          style={s.ctaPrimary}
          onPress={() => router.push("/work-with-me")}
        >
          <Text style={s.ctaPrimaryText}>Book a 30-minute conversation</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={s.ctaGhost}
          onPress={() => goToAnchor("how-it-works", router)}
        >
          <Text style={s.ctaGhostText}>See how it works</Text>
        </Pressable>
      </View>
      <View style={s.stats}>
        {STATS.map(([n, l]) => (
          <View key={l} style={s.stat}>
            <Text style={s.statN}>{n}</Text>
            <Text style={s.statL}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const make = (t: Palette) => ({
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  h1: {
    fontFamily: FRAUNCES.regular,
    fontSize: typography.sizeXxl + 8,
    lineHeight: (typography.sizeXxl + 8) * 1.15,
    color: t.text,
    ...Platform.select({ web: { letterSpacing: -0.02 * 16 }, default: {} }),
  },
  sub: {
    fontSize: typography.sizeMd,
    lineHeight: typography.sizeMd * typography.lineHeightRelaxed,
    color: t.textSecondary,
    maxWidth: 640,
  },
  ctas: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: spacing.md,
  },
  ctaPrimary: {
    backgroundColor: t.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  ctaPrimaryText: {
    color: t.primaryText,
    fontWeight: "600" as const,
    fontSize: typography.sizeSm,
  },
  ctaGhost: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  ctaGhostText: {
    color: t.text,
    fontWeight: "500" as const,
    fontSize: typography.sizeSm,
  },
  stats: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  stat: {
    gap: spacing.xs / 2,
    minWidth: 140,
  },
  statN: {
    color: t.text,
    fontWeight: "600" as const,
    fontSize: typography.sizeSm,
  },
  statL: {
    color: t.textMuted,
    fontSize: typography.sizeXs,
  },
});
