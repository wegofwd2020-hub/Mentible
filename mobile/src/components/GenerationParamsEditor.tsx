import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { HelpHint } from "@/help";
import { LevelPicker } from "@/components/LevelPicker";
import { DEPTHS } from "@/constants/depths";
import { PROVIDERS, providerInfo } from "@/constants/providers";
import { REGISTERS } from "@/constants/registers";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import type { GenerationParams } from "@/types/generationParams";

// The single editor for the generation template (Model + Level + Depth + Pages),
// shared by Settings (global default) and the book generate screen (per-book).
// Stepper buttons keep Pages settable without a soft keyboard (the emulator
// doesn’t always render one).
export function GenerationParamsEditor({
  value,
  onChange,
  pagesLabel = "Pages (whole book)",
  pagesHint = "Total pages across all topics, split evenly. 0 = as much as the model produces. Use − / + if the keyboard doesn’t open.",
}: {
  value: GenerationParams;
  onChange: (next: GenerationParams) => void;
  pagesLabel?: string;
  pagesHint?: string;
}) {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const set = (patch: Partial<GenerationParams>) => onChange({ ...value, ...patch });
  const adjustPages = (delta: number) =>
    set({ pages: Math.min(999, Math.max(0, value.pages + delta)) });

  // A field heading with an inline `?` HelpHint (SBQ-UI-003). The always-visible
  // paramHint under each control stays; the hint carries a deeper "how to choose"
  // tip for users who want it.
  function FieldLabel({ children, hint }: { children: string; hint: string }) {
    return (
      <View style={styles.labelRow}>
        <Text style={styles.label}>{children}</Text>
        <HelpHint label={children} text={hint} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FieldLabel hint="Authoring-grade models give the most coherent long books; experimental ones are faster or cheaper but rougher. Switching providers clears the model pick.">
        Model
      </FieldLabel>
      <Text style={styles.paramHint}>
        Which AI writes the book — pinned for every topic. Needs that provider&apos;s key in Settings.
      </Text>
      <View style={styles.chipRow}>
        {PROVIDERS.map((p) => {
          const selected = p.id === value.provider;
          return (
            <Pressable
              key={p.id}
              onPress={() => set({ provider: p.id, model: null })}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${p.label}${p.tier === "experimental" ? " — experimental" : ""}`}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{p.label}</Text>
              <Text style={[styles.chipDesc, selected && styles.chipDescSelected]}>
                {p.tier === "authoring" ? "Authoring-grade" : "Experimental"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {providerInfo(value.provider).note ? (
        <Text style={styles.paramHint}>{providerInfo(value.provider).note}</Text>
      ) : null}

      <FieldLabel hint="Set it to the reader's level, not the topic's difficulty — an advanced topic at a beginner level is explained from the ground up.">
        Level
      </FieldLabel>
      <Text style={styles.paramHint}>Who it&apos;s written for — sets the reading level and assumed background.</Text>
      <LevelPicker value={value.level} onChange={(level) => set({ level })} />

      <FieldLabel hint="More depth means more sections and detail per topic — and longer generation time and higher token use.">
        Depth
      </FieldLabel>
      <Text style={styles.paramHint}>How thorough — how many sections and how much detail.</Text>
      <View style={styles.chipRow}>
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
      </View>

      <FieldLabel hint="Conceptual favours metaphor and overview visuals; technical favours precise, architectural ones. Tap 'See examples' to compare.">
        Diagrams
      </FieldLabel>
      <Text style={styles.paramHint}>What kind of visuals the model favours (conceptual ↔ technical).</Text>
      <View style={styles.chipRow}>
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
      </View>
      <Pressable
        onPress={() => router.push("/diagram-types")}
        accessibilityRole="button"
        accessibilityLabel="See diagram examples"
        hitSlop={8}
      >
        <Text style={styles.examplesLink}>See examples →</Text>
      </Pressable>

      <FieldLabel hint="A target the model aims for across all topics, not a hard limit — set 0 to let each topic run as long as it needs.">
        {pagesLabel}
      </FieldLabel>
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
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) => ({
  root: { gap: spacing.xs },
  // Field heading + its `?` HelpHint on one row (the label keeps its own marginTop).
  labelRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  // Wrap chips onto multiple rows rather than scrolling horizontally, so every
  // option stays visible in the narrow desktop options column (and on phones).
  chipRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm, paddingVertical: spacing.xs },
  // Beveled, matching the nav tiles: raised white face by default, inset yellow
  // face when selected. Black glyphs throughout; the face + bevel carry on/off.
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.tileOffFace,
    borderWidth: 2,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
    alignItems: "center" as const,
  },
  chipSelected: {
    backgroundColor: c.tileOnFace,
    borderTopColor: c.tileOnLo,
    borderLeftColor: c.tileOnLo,
    borderBottomColor: c.tileOnHi,
    borderRightColor: c.tileOnHi,
  },
  chipLabel: { fontSize: typography.sizeSm, fontWeight: "600" as const, color: c.tileOffGlyph },
  chipLabelSelected: { color: c.tileOnGlyph },
  chipDesc: { fontSize: typography.sizeXs, color: c.tileSubGlyph, marginTop: 2 },
  chipDescSelected: { color: c.tileSubGlyph },
  // wrap so the steppers drop to a second line rather than overflowing the
  // (narrow) options column and spilling over the topics column on desktop web.
  pagesRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "stretch" as const, gap: spacing.xs },
  pagesInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  pagesInputFlex: { flex: 1, minWidth: 120 },
  // Raised white beveled buttons, matching the OFF chips/tiles.
  stepBtn: {
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.md,
    minWidth: 52,
    backgroundColor: c.tileOffFace,
    borderRadius: radius.md,
    borderWidth: 2,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
  },
  stepBtnText: { color: c.tileOffGlyph, fontSize: typography.sizeMd, fontWeight: "700" as const },
  hint: { color: c.textMuted, fontSize: typography.sizeXs },
  paramHint: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: -2, marginBottom: 2 },
  examplesLink: {
    color: c.brand,
    fontSize: typography.sizeXs,
    fontWeight: "700" as const,
    marginTop: spacing.xs,
  },
});
