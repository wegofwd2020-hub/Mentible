import React from "react";
import { ScrollView, View } from "react-native";
import { Hero } from "./Hero";
import { ApprovalCardExample } from "./ApprovalCardExample";
import { Phases } from "./Phases";
import { Formats } from "./Formats";
import { PilotCTA } from "./PilotCTA";
import { useThemedStyles } from "@/theme";
import { useResponsive } from "@/hooks/useResponsive";
import { spacing, type Palette } from "@/constants/theme";

export function LandingHome(): React.JSX.Element {
  const s = useThemedStyles(make);
  const { isDesktop } = useResponsive();
  return (
    <ScrollView style={s.page} contentContainerStyle={s.inner}>
      <View style={s.content}>
        {isDesktop ? (
          // Wide screens: the hero and the approval-record card sit side by side,
          // matching the marketing layout. They stack on narrow screens.
          <View style={s.heroRow}>
            <View style={s.heroCol}>
              <Hero />
            </View>
            <View style={s.cardCol}>
              <ApprovalCardExample />
            </View>
          </View>
        ) : (
          <>
            <Hero />
            <ApprovalCardExample />
          </>
        )}
        <Phases />
        <Formats />
        <PilotCTA />
      </View>
    </ScrollView>
  );
}

const make = (t: Palette) => ({
  page: {
    flex: 1,
    backgroundColor: t.background,
  },
  inner: {
    paddingBottom: spacing.xxl,
  },
  content: {
    width: "100%" as const,
    maxWidth: 1160,
    alignSelf: "center" as const,
    gap: spacing.xxl,
  },
  heroRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xl,
  },
  heroCol: {
    flex: 1.15,
  },
  cardCol: {
    flex: 1,
    maxWidth: 560,
  },
});
