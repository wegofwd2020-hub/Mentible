import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HelpButton } from "@/components/HelpButton";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Shared chrome for a single first-run wizard step. Presentational only — the
// coordinator (FirstRunWizard) supplies the Modal/overlay and the step logic.
// Each step renders its own body as `children`; the scaffold draws the progress
// dots, header (with an optional contextual Help link), and the primary/skip
// footer so every step looks and behaves the same.

export interface WizardScaffoldProps {
  // 0-based index of this step and the total, for the progress dots.
  stepIndex: number;
  stepCount: number;
  title: string;
  subtitle?: string;
  // Help topic id deep-linked from the header "?" (see constants/helpContent.ts).
  helpTopic?: string;
  children?: React.ReactNode;

  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;

  // Pass null to hide the skip affordance (e.g. a terminal step).
  skipLabel?: string | null;
  onSkip?: () => void;
}

export function WizardScaffold({
  stepIndex,
  stepCount,
  title,
  subtitle,
  helpTopic,
  children,
  primaryLabel = "Continue",
  onPrimary,
  primaryDisabled = false,
  primaryBusy = false,
  skipLabel = "Skip for now",
  onSkip,
}: WizardScaffoldProps) {
  return (
    <View style={styles.card}>
      <View style={styles.dots} accessibilityRole="progressbar">
        {Array.from({ length: stepCount }).map((_, i) => (
          <View key={i} style={[styles.dot, i === stepIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {helpTopic ? <HelpButton topic={helpTopic} label={title} /> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {children}
      </ScrollView>

      {/* A step that supplies no onPrimary (e.g. signup, whose AuthForm has its
          own CTAs) gets no scaffold primary button — just the skip link. */}
      {onPrimary ? (
        <Pressable
          style={[styles.primaryBtn, (primaryDisabled || primaryBusy) && styles.primaryBtnDisabled]}
          onPress={onPrimary}
          disabled={primaryDisabled || primaryBusy}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: primaryDisabled || primaryBusy }}
        >
          {primaryBusy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
          )}
        </Pressable>
      ) : null}

      {skipLabel && onSkip ? (
        <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel={skipLabel} hitSlop={8}>
          <Text style={styles.skipText}>{skipLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.xs, marginBottom: spacing.xs },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.borderLight,
  },
  dotActive: { backgroundColor: colors.primary, width: 22 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontSize: typography.sizeXl, fontWeight: "800", color: colors.text },
  subtitle: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  // flexShrink (RN defaults it to 0) lets the scroll body shrink to fit when the
  // card hits maxHeight, so long content (e.g. the "Add an LLM key" step) scrolls
  // *inside* the card instead of being clipped / pushing the footer off-screen.
  body: { flexShrink: 1 },
  bodyContent: { paddingVertical: spacing.sm, gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
  skipText: {
    color: colors.textSecondary,
    fontSize: typography.sizeSm,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
});
