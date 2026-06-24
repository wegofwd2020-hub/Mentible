import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { NAV } from "@/constants/labels";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { WizardScaffold } from "../WizardScaffold";
import type { WizardStepProps } from "./types";

type IconName = keyof typeof Ionicons.glyphMap;

// The five top-nav tabs, mirroring TopNavBar (same icons + shared NAV labels) so
// the tour reads exactly like the real menu.
const TABS: { icon: IconName; label: string; blurb: string }[] = [
  { icon: "library-outline", label: NAV.library, blurb: "Your finished books — tap a cover to read." },
  { icon: "create-outline", label: NAV.studio, blurb: "Create and edit your own books." },
  { icon: "settings-outline", label: NAV.settings, blurb: "Your LLM keys and preferences." },
  { icon: "help-circle-outline", label: NAV.help, blurb: "Guides — and you can replay these walkthroughs." },
  { icon: "information-circle-outline", label: NAV.about, blurb: "Version and privacy." },
];

const READ_STEPS = [
  "Open Library and tap a book cover.",
  "Inside the book, tap a topic to read its lesson.",
  "Use Export to save the book as an EPUB or PDF for offline reading.",
];

// Step 3 of the first run: a quick two-page illustrated tour — the tabs, then how
// to open a book. The final CTA closes the tour and drops the user into their
// Library. Skippable like the other steps.
export function TourStep({ stepIndex, stepCount, onDone, onSkip }: WizardStepProps) {
  const router = useRouter();
  const [page, setPage] = useState<0 | 1>(0);

  // Mark the step done first (which unmounts the coordinator's modal), then
  // navigate so the Library isn't left sitting behind a dismissing overlay.
  const openLibrary = () => {
    onDone();
    router.push("/library");
  };

  if (page === 0) {
    return (
      <WizardScaffold
        stepIndex={stepIndex}
        stepCount={stepCount}
        title="Meet your tabs"
        subtitle="Mentible has five places, along the top of the app."
        helpTopic="reading-a-book"
        primaryLabel="Next"
        onPrimary={() => setPage(1)}
        skipLabel="Skip tour"
        onSkip={onSkip}
      >
        <View style={styles.tabList}>
          {TABS.map((t) => (
            <View key={t.label} style={styles.tabRow}>
              <View style={styles.iconTile}>
                <Ionicons name={t.icon} size={22} color={colors.tileOffGlyph} />
              </View>
              <View style={styles.tabText}>
                <Text style={styles.tabLabel}>{t.label}</Text>
                <Text style={styles.tabBlurb}>{t.blurb}</Text>
              </View>
            </View>
          ))}
        </View>
      </WizardScaffold>
    );
  }

  return (
    <WizardScaffold
      stepIndex={stepIndex}
      stepCount={stepCount}
      title="Open a book to read"
      subtitle="Your Library already has a book ready to open."
      helpTopic="reading-a-book"
      primaryLabel="Open my Library"
      onPrimary={openLibrary}
      skipLabel="I'll explore myself"
      onSkip={onDone}
    >
      <View style={styles.steps}>
        {READ_STEPS.map((s, i) => (
          <View key={i} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>
    </WizardScaffold>
  );
}

const styles = StyleSheet.create({
  tabList: { gap: spacing.sm },
  tabRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  // A calm echo of the nav tile: white face, dark glyph, soft bevel.
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.tileOffFace,
    borderWidth: 2,
    borderTopColor: colors.tileOffFace,
    borderLeftColor: colors.tileOffFace,
    borderBottomColor: colors.tileOffShadow,
    borderRightColor: colors.tileOffShadow,
    justifyContent: "center",
    alignItems: "center",
  },
  tabText: { flex: 1 },
  tabLabel: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text },
  tabBlurb: { fontSize: typography.sizeSm, color: colors.textSecondary, lineHeight: 19 },
  steps: { gap: spacing.md, marginTop: spacing.xs },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary + "33",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  stepText: { flex: 1, fontSize: typography.sizeMd, color: colors.text, lineHeight: 22 },
});
