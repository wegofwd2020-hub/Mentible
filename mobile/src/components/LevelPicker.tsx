import React from "react";
import {
  Pressable,
  ScrollView,
  Text,
} from "react-native";
import { LEVELS } from "@/constants/levels";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface LevelPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function LevelPicker({ value, onChange }: LevelPickerProps) {
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) => ({
  row: {
    flexDirection: "row" as const,
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
  chipLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.tileOffGlyph,
  },
  chipLabelSelected: {
    color: c.tileOnGlyph,
  },
  chipDesc: {
    fontSize: typography.sizeXs,
    color: c.tileSubGlyph,
    marginTop: 2,
  },
  chipDescSelected: {
    color: c.tileSubGlyph,
  },
});
