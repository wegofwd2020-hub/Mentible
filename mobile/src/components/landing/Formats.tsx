import React from "react";
import { View, Text } from "react-native";
import { Chip } from "@/components/ui/Chip";
import { Label } from "@/components/ui/Label";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { spacing, typography, type Palette } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

// Built exports ONLY (honesty guardrail — see brief Global Constraints). Do
// NOT add YouTube, Newsletter, or any learning-module entry here.
const FORMATS = [
  "Book",
  "EPUB",
  "PDF",
  "DOCX",
  "KDP pack",
  "LinkedIn post",
  "Carousel",
  "X thread",
  "Image card",
  "Animated card",
  "Audio",
];

export function Formats(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <View style={s.section} {...sectionAnchor("formats")}>
      <Label>Formats</Label>
      <Text style={s.heading}>One source, every derivative.</Text>
      <View style={s.chips}>
        {FORMATS.map((f) => (
          <Chip key={f} label={f} />
        ))}
      </View>
    </View>
  );
}

const make = (t: Palette) => ({
  section: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    fontFamily: FRAUNCES.regular,
    fontSize: typography.sizeXl,
    color: t.text,
  },
  chips: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: spacing.sm,
  },
});
