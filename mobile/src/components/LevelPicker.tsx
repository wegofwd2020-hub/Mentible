import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LEVELS } from "@/constants/levels";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface LevelPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function LevelPicker({ value, onChange }: LevelPickerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {LEVELS.map((level) => {
        const selected = level.value === value;
        return (
          <Pressable
            key={level.value}
            onPress={() => onChange(level.value)}
            style={[styles.chip, selected && styles.chipSelected]}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${level.label} — ${level.description}`}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
              {level.label}
            </Text>
            <Text style={[styles.chipDesc, selected && styles.chipDescSelected]}>
              {level.description}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "22",
  },
  chipLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  chipLabelSelected: {
    color: colors.primary,
  },
  chipDesc: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
    marginTop: 2,
  },
  chipDescSelected: {
    color: colors.primary + "cc",
  },
});
