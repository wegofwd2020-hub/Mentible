import React from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { PHASE_LABELS, PHASE_ORDER, type PhaseKey, type ProjectPhase } from "@/lib/projectPhase";

export function PhaseTabBar({
  phase, selected, onSelect,
}: { phase: ProjectPhase; selected: PhaseKey; onSelect: (k: PhaseKey) => void }): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const currentKey = PHASE_ORDER[phase.currentIdx];
  return (
    <View style={styles.bar} accessibilityLabel="Project phases">
      {phase.phases.map((p) => {
        const state = p.done ? "done" : p.key === currentKey ? "current" : "upcoming";
        const glyph = state === "done" ? "✓" : state === "current" ? "●" : "○";
        const active = p.key === selected;
        return (
          <Pressable
            key={p.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${PHASE_LABELS[p.key]}: ${state}`}
            onPress={() => onSelect(p.key)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.glyph, state === "current" && styles.glyphCurrent, state === "done" && styles.glyphDone]}>{glyph}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{PHASE_LABELS[p.key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: { flexDirection: "row" as const, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: "center" as const, paddingVertical: spacing.sm, borderRadius: radius.sm, gap: 2 },
  tabActive: { backgroundColor: c.surfaceHigh },
  glyph: { fontSize: typography.sizeMd, color: c.textMuted },
  glyphCurrent: { color: c.primary, fontWeight: "700" as const },
  glyphDone: { color: c.growth },
  label: { fontSize: typography.sizeXs, color: c.textSecondary },
  labelActive: { color: c.text, fontWeight: "700" as const },
});
