import React, { useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { IS_DEMO } from "@/constants/demo";
import { NAV_ORDER, NAV_TABS } from "@/components/navItems";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { WizardScaffold } from "../WizardScaffold";
import type { WizardStepProps } from "./types";

type IconName = keyof typeof Ionicons.glyphMap;

// One-line description per nav destination. Keyed by route name so the tour can
// be DERIVED from the real nav below (rather than a hand-kept parallel list that
// drifts when the menu changes). Extra keys (shelves/books/posts) are harmless —
// they only render if that route is put back into NAV_ORDER.
const TAB_BLURBS: Record<string, string> = {
  index: "Your home base — what Mentible does, how it works, and where to start.",
  library: "Your finished books — tap a cover to read.",
  projects: "Capture your expertise into a project — draft it, get it validated, then publish.",
  reviews: "Review and approve projects you've been invited to validate.",
  settings: "Your themes, LLM keys and preferences.",
  help: "Guides — and you can replay these walkthroughs.",
  about: "Version and privacy.",
  shelves: "Browse free book catalogs and download books to read offline.",
  books: "Create and edit your own books.",
  posts: "Turn your work into shareable posts.",
};

// The tour tabs mirror the REAL menu exactly — same order, same labels/icons, and
// the same demo filtering — because both come from NAV_ORDER + NAV_TABS.
const TABS: { icon: IconName; label: string; blurb: string }[] = NAV_ORDER.map((name) => ({
  icon: NAV_TABS[name].inactive as IconName,
  label: NAV_TABS[name].label,
  blurb: TAB_BLURBS[name] ?? "",
}));

const READ_STEPS = [
  "Open Library and tap a book cover.",
  "Inside the book, tap a topic to read its lesson.",
  "Use Export to save the book as an EPUB or PDF for offline reading.",
];

// Step 3 of the first run: a quick two-page illustrated tour — the tabs, then how
// to open a book. The final CTA closes the tour and drops the user into their
// Library. Skippable like the other steps.
export function TourStep({ stepIndex, stepCount, onDone, onSkip }: WizardStepProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [page, setPage] = useState<0 | 1>(0);

  // Mark the step done first (which unmounts the coordinator's modal), then
  // navigate so the Library isn't left sitting behind a dismissing overlay.
  const openLibrary = () => {
    onDone();
    router.push("/library");
  };

  // Same pattern as openLibrary, but into the trust-authoring flow — the
  // real-build fork's primary path (ADR-037: SME-primary, "start a project").
  const startProject = () => {
    onDone();
    router.push("/trust/new");
  };

  if (page === 0) {
    return (
      <WizardScaffold
        stepIndex={stepIndex}
        stepCount={stepCount}
        title="Meet your tabs"
        subtitle="Your menu, along the top of the app."
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
                <Ionicons name={t.icon} size={22} color={theme.tileOffGlyph} />
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

  // Real builds fork here (ADR-037): the tour's payoff is authoring, not just
  // reading, so the final CTA offers to start a project — with "just read"
  // as the (still fully supported) skip path into the Library. The demo
  // build has no backend/accounts, so it keeps the original read-only page.
  if (!IS_DEMO) {
    return (
      <WizardScaffold
        stepIndex={stepIndex}
        stepCount={stepCount}
        title="What would you like to do?"
        subtitle="Mentible is built for capturing and validating expert knowledge — but reading is always here too."
        helpTopic="reading-a-book"
        primaryLabel="Start a project"
        onPrimary={startProject}
        skipLabel="Just read for now"
        onSkip={openLibrary}
      >
        <View style={styles.steps}>
          <View style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>1</Text>
            </View>
            <Text style={styles.stepText}>Create — capture your expertise into a project and invite a reviewer to validate it.</Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>2</Text>
            </View>
            <Text style={styles.stepText}>Read — your Library already has a book ready to open.</Text>
          </View>
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

const makeStyles = (c: Palette) => ({
  tabList: { gap: spacing.sm },
  tabRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  // A calm echo of the nav tile: white face, dark glyph, soft bevel.
  iconTile: {
    width: 44 as const,
    height: 44 as const,
    borderRadius: radius.md,
    backgroundColor: c.tileOffFace,
    borderWidth: 2 as const,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  tabText: { flex: 1 as const },
  tabLabel: { fontSize: typography.sizeMd, fontWeight: "700" as const, color: c.text },
  tabBlurb: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 19 as const },
  steps: { gap: spacing.md, marginTop: spacing.xs },
  step: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  stepNum: {
    width: 24 as const,
    height: 24 as const,
    borderRadius: 12 as const,
    backgroundColor: c.primary + "33",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  stepNumText: { color: c.primary, fontWeight: "700" as const, fontSize: typography.sizeSm },
  stepText: { flex: 1 as const, fontSize: typography.sizeMd, color: c.text, lineHeight: 22 as const },
});
