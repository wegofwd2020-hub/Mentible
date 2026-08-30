import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Hero } from "./Hero";
import { ApprovalCardExample } from "./ApprovalCardExample";
import { Phases } from "./Phases";
import { Formats } from "./Formats";
import { PilotCTA } from "./PilotCTA";
import { setAnchorScroller, getSectionOffset } from "./landingScroll";
import { useTheme, useThemedStyles } from "@/theme";
import { useResponsive } from "@/hooks/useResponsive";
import { mix, spacing, type Palette } from "@/constants/theme";

export function LandingHome(): React.JSX.Element {
  const s = useThemedStyles(make);
  const t = useTheme();
  const { isDesktop } = useResponsive();
  const scrollRef = useRef<ScrollView>(null);

  // Let the nav's marketing links (goToAnchor) scroll this single-page landing to
  // a section on native — sections report their offsets via `sectionAnchor`'s
  // onLayout. Web keeps its own scrollIntoView path.
  useEffect(() => {
    setAnchorScroller((anchor) =>
      scrollRef.current?.scrollTo({ y: getSectionOffset(anchor), animated: true }),
    );
    return () => setAnchorScroller(null);
  }, []);

  return (
    // The Home / landing gets a subtle brand-tinted gradient (a soft top tint that
    // fades to the flat app `background`), so the "front door" reads distinct from
    // the utilitarian app screens (Library/Projects/…) which stay flat. Scoped to
    // THIS scene only — the shared tab `sceneStyle` stays opaque `background`, so
    // this doesn't reintroduce the tab-scene bleed (see (tabs)/_layout.tsx).
    <View style={s.root}>
      <LinearGradient
        colors={[mix(t.background, t.brand, 0.1), t.background]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView ref={scrollRef} style={s.page} contentContainerStyle={s.inner}>
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
    </View>
  );
}

const make = (_t: Palette) => ({
  // The gradient behind fills this; the ScrollView is transparent so it shows.
  root: { flex: 1 },
  page: {
    flex: 1,
    backgroundColor: "transparent" as const,
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
