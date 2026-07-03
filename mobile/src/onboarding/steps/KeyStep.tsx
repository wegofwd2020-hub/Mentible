import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProviderKeyForm } from "@/components/ProviderKeyForm";
import { DEFAULT_PROVIDER_ID, PROVIDERS, providerInfo } from "@/constants/providers";
import { COST_LABEL, providerGuide, type ProviderGuide } from "@/constants/providerGuides";
import { loadApiKey } from "@/secure/keyStore";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { WizardScaffold } from "../WizardScaffold";
import type { WizardStepProps } from "./types";

// Step 2 of the first run: pick a provider, follow the per-provider guide to get
// a key, and paste it. Continue unlocks once at least one provider has a saved
// key (pre-existing keys count, so a returning user isn't blocked).
export function KeyStep({ stepIndex, stepCount, onDone, onSkip }: WizardStepProps) {
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
      {guide ? <ProviderGuideCard guide={guide} keyHint={hint} /> : null}
    </WizardScaffold>
  );
}

function ProviderGuideCard({ guide, keyHint }: { guide: ProviderGuide; keyHint: string }) {
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
        <Ionicons name="open-outline" size={16} color={colors.primary} />
        <Text style={styles.openBtnText}>Open {guide.consoleLabel}</Text>
      </Pressable>

      <Text style={styles.hint}>Your key looks like {keyHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  badgeRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeFree: { backgroundColor: colors.growth + "22", borderColor: colors.growth },
  badgePaid: { backgroundColor: colors.warning + "22", borderColor: colors.warning },
  badgeText: { fontSize: typography.sizeXs, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  badgeTextFree: { color: colors.growth },
  badgeTextPaid: { color: colors.warning },
  costNote: { flex: 1, fontSize: typography.sizeXs, color: colors.textSecondary, lineHeight: 17 },
  howTitle: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.xs,
  },
  steps: { gap: spacing.xs },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary + "33",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeXs },
  stepText: { flex: 1, fontSize: typography.sizeSm, color: colors.text, lineHeight: 20 },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  openBtnText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "600" },
  hint: { fontSize: typography.sizeXs, color: colors.textMuted, fontFamily: "monospace" },
});
