import React from "react";
import { View, Text } from "react-native";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { spacing, typography, type Palette } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

const PHASES: Array<[string, string, string]> = [
  [
    "01",
    "Capture",
    "Paste transcripts, notes, and links; we organize them into labelled sources.",
  ],
  [
    "02",
    "Create",
    "AI drafts an outline and cornerstone asset from those sources only — every section attributed to its source, inventing nothing. A grounding check flags any unbacked claim.",
  ],
  [
    "03",
    "Validate",
    "The named expert reviews each version, leaves feedback, and approves or withdraws it. Approval is stamped with who recorded it; coverage and readability score automatically.",
  ],
  [
    "04",
    "Share",
    "Publish the approved master to your chosen export formats, plus social derivatives.",
  ],
];

export function Phases(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <View style={s.section} {...sectionAnchor("how-it-works")}>
      <Label>How it works</Label>
      <Text style={s.heading}>Four phases, one traceable thread.</Text>
      <View style={s.grid}>
        {PHASES.map(([num, name, body]) => (
          <Card key={num} style={s.card}>
            <Text style={s.num}>{num}</Text>
            <Text style={s.name}>{name}</Text>
            <Text style={s.body}>{body}</Text>
          </Card>
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
  grid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  card: {
    flexGrow: 1,
    flexBasis: 220,
    gap: spacing.xs,
  },
  num: {
    color: t.primary,
    fontWeight: "700" as const,
    fontSize: typography.sizeSm,
  },
  name: {
    color: t.text,
    fontWeight: "600" as const,
    fontSize: typography.sizeMd,
  },
  body: {
    color: t.textSecondary,
    fontSize: typography.sizeSm,
    lineHeight: typography.sizeSm * typography.lineHeightNormal,
  },
});
