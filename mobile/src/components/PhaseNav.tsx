import { StyleSheet, View } from "react-native";
import { Button } from "@/components/ui";
import { PHASE_LABELS, PHASE_ORDER, type PhaseKey } from "@/lib/projectPhase";
import { spacing } from "@/constants/theme";

// Wizard-style Back/Next for the project phase flow, pinned bottom-right (the
// conventional placement). Pure navigation over PHASE_ORDER — no gating, no side
// effects — so owners and reviewers alike can move between phases. Back is hidden
// on the first phase, Next on the last. Each phase's real action (Suggest /
// Generate / Publish) remains the single gold primary within its panel; Next is
// the forward primary here, Back the ghost.
export function PhaseNav({
  phaseKey,
  onSelect,
}: {
  phaseKey: PhaseKey;
  onSelect: (k: PhaseKey) => void;
}) {
  const idx = PHASE_ORDER.indexOf(phaseKey);
  const prev = idx > 0 ? PHASE_ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
  if (!prev && !next) return null;
  return (
    <View style={styles.row}>
      {prev ? (
        <Button
          variant="ghost"
          label="Back"
          accessibilityLabel={`Back to ${PHASE_LABELS[prev]}`}
          onPress={() => onSelect(prev)}
        />
      ) : null}
      {next ? (
        <Button
          variant="primary"
          label="Next"
          accessibilityLabel={`Next to ${PHASE_LABELS[next]}`}
          onPress={() => onSelect(next)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
