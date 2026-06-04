import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LevelPicker } from "@/components/LevelPicker";
import { DEPTHS } from "@/constants/depths";
import { REGISTERS } from "@/constants/registers";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { GenerationParams } from "@/types/generationParams";

// The single editor for the generation template (Level + Depth + Pages), shared
// by Settings (global default), the book generate screen (per-book), and the
// Query screen (one-off). Stepper buttons keep Pages settable without a soft
// keyboard (the emulator doesn't always render one).
export function GenerationParamsEditor({
  value,
  onChange,
  pagesLabel = "Pages (whole book)",
  pagesHint = "Total pages across all topics, split evenly. 0 = as much as the model produces. Use − / + if the keyboard doesn’t open.",
}: {
  value: GenerationParams;
  onChange: (next: GenerationParams) => void;
  // Override for the single-lesson Query screen (pages aren't a whole-book sum).
  pagesLabel?: string;
  pagesHint?: string;
}) {
  const set = (patch: Partial<GenerationParams>) => onChange({ ...value, ...patch });
  const adjustPages = (delta: number) =>
    set({ pages: Math.min(999, Math.max(0, value.pages + delta)) });

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Level</Text>
      <LevelPicker value={value.level} onChange={(level) => set({ level })} />

      <Text style={styles.label}>Depth</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {DEPTHS.map((d) => {
          const selected = d.value === value.depth;
          return (
            <Pressable
              key={d.value}
              onPress={() => set({ depth: d.value })}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${d.label} — ${d.description}`}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{d.label}</Text>
              <Text style={[styles.chipDesc, selected && styles.chipDescSelected]}>{d.description}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>Diagrams</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {REGISTERS.map((r) => {
          const selected = r.value === value.diagramRegister;
          return (
            <Pressable
              key={r.value}
              onPress={() => set({ diagramRegister: r.value })}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${r.label} — ${r.description}`}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{r.label}</Text>
              <Text style={[styles.chipDesc, selected && styles.chipDescSelected]}>{r.description}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.label}>{pagesLabel}</Text>
      <View style={styles.pagesRow}>
        <Pressable
          style={styles.stepBtn}
          onPress={() => adjustPages(-10)}
          accessibilityRole="button"
          accessibilityLabel="Decrease pages by 10"
        >
          <Text style={styles.stepBtnText}>−10</Text>
        </Pressable>
        <Pressable
          style={styles.stepBtn}
          onPress={() => adjustPages(-1)}
          accessibilityRole="button"
          accessibilityLabel="Decrease pages by 1"
        >
          <Text style={styles.stepBtnText}>−1</Text>
        </Pressable>
        <TextInput
          style={[styles.pagesInput, styles.pagesInputFlex]}
          value={value.pages > 0 ? String(value.pages) : ""}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
            set({ pages: Number.isFinite(n) ? Math.min(999, n) : 0 });
          }}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          maxLength={3}
          textAlign="center"
          accessibilityLabel="Target pages for the whole book — 0 means no limit"
        />
        <Pressable
          style={styles.stepBtn}
          onPress={() => adjustPages(1)}
          accessibilityRole="button"
          accessibilityLabel="Increase pages by 1"
        >
          <Text style={styles.stepBtnText}>+1</Text>
        </Pressable>
        <Pressable
          style={styles.stepBtn}
          onPress={() => adjustPages(10)}
          accessibilityRole="button"
          accessibilityLabel="Increase pages by 10"
        >
          <Text style={styles.stepBtnText}>+10</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{pagesHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "22" },
  chipLabel: { fontSize: typography.sizeSm, fontWeight: "600", color: colors.textSecondary },
  chipLabelSelected: { color: colors.primary },
  chipDesc: { fontSize: typography.sizeXs, color: colors.textMuted, marginTop: 2 },
  chipDescSelected: { color: colors.primary + "cc" },
  pagesRow: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs },
  pagesInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  pagesInputFlex: { flex: 1 },
  stepBtn: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    minWidth: 52,
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  stepBtnText: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: typography.sizeXs },
});
