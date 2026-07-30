import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProjectDetailView } from "@/api/trustClient";
import { colors, radius, spacing, typography } from "@/constants/theme";

type Phase = { key: string; label: string; done: boolean };

// The next-step line for the CURRENT phase, by role. Never implies validation
// before a version is actually approved (Share copy appears only at that point).
function nextStep(currentKey: string, isOwner: boolean): string {
  switch (currentKey) {
    case "capture":
      return isOwner
        ? "Next: add a source — paste a transcript, note, or link below."
        : "The owner is still capturing sources.";
    case "create":
      return isOwner
        ? "Next: generate a draft from your sources below."
        : "Waiting for the owner to generate a draft.";
    case "validate":
      return isOwner
        ? "Next: invite an expert to review — they approve a version below."
        : "Your turn: review the latest version and approve it below.";
    default: // share
      return "This project has an expert-validated version. Share it from the Posts tab.";
  }
}

export function TrustJourney({
  detail,
  isOwner,
  onNext,
}: {
  detail: ProjectDetailView;
  isOwner: boolean;
  onNext?: (phaseKey: string) => void;
}): React.JSX.Element {
  const captured = (detail.inputs?.length ?? 0) > 0;
  const created = detail.artifacts.some((a) => a.versions.length > 0);
  const validated = detail.artifacts.some((a) => a.versions.some((v) => v.is_validated));
  const phases: Phase[] = [
    { key: "capture", label: "Capture", done: captured },
    { key: "create", label: "Create", done: created },
    { key: "validate", label: "Validate", done: validated },
    { key: "share", label: "Share", done: false }, // Share is the goal, actioned on the Posts tab
  ];
  // First not-done phase is "current". Share is never done, so this is always ≥0.
  const currentIdx = phases.findIndex((p) => !p.done);
  const currentKey = phases[currentIdx].key;
  const nextText = nextStep(currentKey, isOwner);

  return (
    <View style={styles.wrap} accessibilityLabel="Project journey">
      <View style={styles.row}>
        {phases.map((p, i) => {
          const state = p.done ? "done" : i === currentIdx ? "current" : "upcoming";
          const glyph = state === "done" ? "✓" : state === "current" ? "●" : "○";
          return (
            <View key={p.key} style={styles.phase} accessibilityLabel={`${p.label}: ${state}`}>
              <Text style={[styles.glyph, state === "current" && styles.glyphCurrent, state === "done" && styles.glyphDone]}>
                {glyph}
              </Text>
              <Text style={[styles.label, state === "current" && styles.labelCurrent]}>{p.label}</Text>
            </View>
          );
        })}
      </View>
      {onNext ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go to next step: ${nextText}`}
          onPress={() => onNext(currentKey)}
        >
          <Text style={styles.nextTappable}>{nextText} →</Text>
        </Pressable>
      ) : (
        <Text style={styles.next}>{nextText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between" },
  phase: { alignItems: "center", flex: 1, gap: 2 },
  glyph: { fontSize: typography.sizeMd, color: colors.textMuted },
  glyphCurrent: { color: colors.primary, fontWeight: "700" },
  glyphDone: { color: colors.growth },
  label: { fontSize: typography.sizeXs, color: colors.textSecondary },
  labelCurrent: { color: colors.text, fontWeight: "700" },
  next: { fontSize: typography.sizeSm, color: colors.text, lineHeight: 20 },
  nextTappable: { fontSize: typography.sizeSm, color: colors.primary, fontWeight: "600", lineHeight: 20 },
});
