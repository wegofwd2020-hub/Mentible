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
  // Beveled, matching the nav tiles. OFF = raised white face (light top/left,
  // grey bottom/right); selected = inset yellow face (dark top/left, light
  // bottom/right). Black glyphs throughout; the face + bevel carry on/off.
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.tileOffFace,
    borderWidth: 2,
    borderTopColor: colors.tileOffFace,
    borderLeftColor: colors.tileOffFace,
    borderBottomColor: colors.tileOffShadow,
    borderRightColor: colors.tileOffShadow,
    alignItems: "center",
  },
  chipSelected: {
    backgroundColor: colors.tileOnFace,
    borderTopColor: colors.tileOnLo,
    borderLeftColor: colors.tileOnLo,
    borderBottomColor: colors.tileOnHi,
    borderRightColor: colors.tileOnHi,
  },
  chipLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.tileOffGlyph,
  },
  chipLabelSelected: {
    color: colors.tileOnGlyph,
  },
  chipDesc: {
    fontSize: typography.sizeXs,
    color: colors.tileSubGlyph,
    marginTop: 2,
  },
  chipDescSelected: {
    color: colors.tileSubGlyph,
  },
});
