import React from "react";
import { ScrollView } from "react-native";
import { Hero } from "./Hero";
import { ApprovalCardExample } from "./ApprovalCardExample";
import { Phases } from "./Phases";
import { Formats } from "./Formats";
import { PilotCTA } from "./PilotCTA";
import { useThemedStyles } from "@/theme";
import { spacing, type Palette } from "@/constants/theme";

export function LandingHome(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <ScrollView style={s.page} contentContainerStyle={s.inner}>
      <Hero />
      <ApprovalCardExample />
      <Phases />
      <Formats />
      <PilotCTA />
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
    gap: spacing.xxl,
  },
});
