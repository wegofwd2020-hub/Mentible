import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { HelpButton } from "@/help";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

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
  // Help topic id deep-linked from the header "?" (see help-content/topics.ts).
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
            <ActivityIndicator color={theme.primaryText} />
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

const makeStyles = (c: Palette) => ({
  card: {
    width: "100%" as const,
    maxWidth: 520 as const,
    maxHeight: "90%" as const,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1 as const,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dots: { flexDirection: "row" as const, justifyContent: "center" as const, gap: spacing.xs, marginBottom: spacing.xs },
  dot: {
    width: 8 as const,
    height: 8 as const,
    borderRadius: radius.full,
    backgroundColor: c.borderLight,
  },
  dotActive: { backgroundColor: c.primary, width: 22 as const },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  title: { flex: 1 as const, fontSize: typography.sizeXl, fontWeight: "800" as const, color: c.text },
  subtitle: {
    fontSize: typography.sizeSm,
    color: c.textSecondary,
    lineHeight: 21 as const,
    marginTop: spacing.xs,
  },
  body: { flexShrink: 1 as const, minHeight: 0 as const },
  bodyContent: { paddingVertical: spacing.sm, gap: spacing.sm },
  primaryBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.xs,
  },
  primaryBtnDisabled: { opacity: 0.5 as const },
  primaryBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeMd },
  skipText: {
    color: c.textSecondary,
    fontSize: typography.sizeSm,
    textAlign: "center" as const,
    paddingVertical: spacing.sm,
  },
});
