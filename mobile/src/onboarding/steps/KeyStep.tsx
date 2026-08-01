import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProviderKeyForm } from "@/components/ProviderKeyForm";
import { DEFAULT_PROVIDER_ID, PROVIDERS, providerInfo } from "@/constants/providers";
import { COST_LABEL, providerGuide, type ProviderGuide } from "@/constants/providerGuides";
import { loadApiKey } from "@/secure/keyStore";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { WizardScaffold } from "../WizardScaffold";
import type { WizardStepProps } from "./types";

// Step 2 of the first run: pick a provider, follow the per-provider guide to get
// a key, and paste it. Continue unlocks once at least one provider has a saved
// key (pre-existing keys count, so a returning user isn't blocked).
export function KeyStep({ stepIndex, stepCount, onDone, onSkip }: WizardStepProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [provider, setProvider] = useState(DEFAULT_PROVIDER_ID);
  const [savedProviders, setSavedProviders] = useState<Set<string>>(() => new Set());

  // Probe which providers already have a stored key so Continue reflects reality
  // on entry (e.g. a returning user, or someone who set a key in Settings first).
  useEffect(() => {
    let active = true;
    void Promise.all(
      PROVIDERS.map((p) => loadApiKey(p.id).then((k) => [p.id, !!k] as const)),
    ).then((entries) => {
      if (!active) return;
      setSavedProviders(new Set(entries.filter(([, has]) => has).map(([id]) => id)));
    });
    return () => {
      active = false;
    };
  }, []);

  const guide = providerGuide(provider);
  const hint = providerInfo(provider).keyHint;
  const hasAnyKey = savedProviders.size > 0;

  const subtitle = useMemo(() => {
    if (!hasAnyKey) {
      return "Bring your own key — pick a provider, grab a key, and paste it below. It stays on this device, is used once per request, and is never logged. You can skip and read the included books first.";
    }
    const n = savedProviders.size;
    return `${n} key${n > 1 ? "s" : ""} saved — you're ready to generate. Add another or continue.`;
  }, [hasAnyKey, savedProviders]);

  const markSaved = (id: string) =>
    setSavedProviders((prev) => new Set(prev).add(id));
  const markCleared = (id: string) =>
    setSavedProviders((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  return (
    <WizardScaffold
      stepIndex={stepIndex}
      stepCount={stepCount}
      title="Add an LLM key"
      subtitle={subtitle}
      helpTopic="provider-keys"
      primaryLabel="Continue"
      primaryDisabled={!hasAnyKey}
      onPrimary={onDone}
      onSkip={onSkip}
    >
      <ProviderKeyForm
        initialProvider={provider}
        onProviderChange={setProvider}
        onSaved={markSaved}
        onCleared={markCleared}
      />
      {guide ? <ProviderGuideCard guide={guide} keyHint={hint} styles={styles} theme={theme} /> : null}
    </WizardScaffold>
  );
}

function ProviderGuideCard({ guide, keyHint, styles, theme }: { guide: ProviderGuide; keyHint: string; styles: ReturnType<typeof makeStyles>; theme: ReturnType<typeof useTheme> }) {
  const free = guide.cost !== "paid";
  return (
    <View style={styles.card}>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, free ? styles.badgeFree : styles.badgePaid]}>
          <Text style={[styles.badgeText, free ? styles.badgeTextFree : styles.badgeTextPaid]}>
            {COST_LABEL[guide.cost]}
          </Text>
        </View>
        <Text style={styles.costNote}>{guide.costNote}</Text>
      </View>

      <Text style={styles.howTitle}>How to get your key</Text>
      <View style={styles.steps}>
        {guide.steps.map((s, i) => (
          <View key={i} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>

      <Pressable
        style={styles.openBtn}
        onPress={() => Linking.openURL(guide.consoleUrl)}
        accessibilityRole="link"
        accessibilityLabel={`Open ${guide.consoleLabel} to get a key`}
      >
        <Ionicons name="open-outline" size={16} color={theme.primary} />
        <Text style={styles.openBtnText}>Open {guide.consoleLabel}</Text>
      </Pressable>

      <Text style={styles.hint}>Your key looks like {keyHint}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  card: {
    backgroundColor: c.surfaceHigh,
    borderColor: c.border,
    borderWidth: 1 as const,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badgeRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2 as const,
    borderRadius: radius.sm,
    borderWidth: 1 as const,
  },
  badgeFree: { backgroundColor: c.growth + "22", borderColor: c.growth },
  badgePaid: { backgroundColor: c.warning + "22", borderColor: c.warning },
  badgeText: { fontSize: typography.sizeXs, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.5 as const },
  badgeTextFree: { color: c.growth },
  badgeTextPaid: { color: c.warning },
  costNote: { flex: 1 as const, fontSize: typography.sizeXs, color: c.textSecondary, lineHeight: 17 as const },
  howTitle: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8 as const,
    marginTop: spacing.xs,
  },
  steps: { gap: spacing.xs },
  step: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  stepNum: {
    width: 20 as const,
    height: 20 as const,
    borderRadius: 10 as const,
    backgroundColor: c.primary + "33",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  stepNumText: { color: c.primary, fontWeight: "700" as const, fontSize: typography.sizeXs },
  stepText: { flex: 1 as const, fontSize: typography.sizeSm, color: c.text, lineHeight: 20 as const },
  openBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    alignSelf: "flex-start" as const,
    paddingVertical: spacing.xs,
  },
  openBtnText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  hint: { fontSize: typography.sizeXs, color: c.textMuted, fontFamily: "monospace" as const },
});
