import React from "react";
import { View, Text } from "react-native";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { spacing, typography, type Palette } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

export interface Phase {
  num: string;
  name: string;
  body: string;
  youGet: string;
}

export const PHASES_HEADING = "From your material to a published book, with every claim traceable.";

export const PHASES: Phase[] = [
  {
    num: "01",
    name: "Capture",
    body: "You bring transcripts, notes, and links. Mentible sorts them into labelled sources.",
    youGet: "a source library that every later claim can point back to.",
  },
  {
    num: "02",
    name: "Create",
    body: "The AI writes an outline and a first draft using only those sources. Each section names its source, and a grounding check flags any sentence the sources do not support.",
    youGet: "a first draft in days, not a blank page, with nothing to check against the sources by hand.",
  },
  {
    num: "03",
    name: "Validate",
    body: "Your named expert reviews each version, comments, and approves or withdraws it.",
    youGet: "a sign-off on record, so readers and reviewers can see who stood behind the content.",
  },
  {
    num: "04",
    name: "Publish",
    body: "The approved master goes out as a book, PDF, or other format, plus social posts cut from the same source.",
    youGet: "one approved source, eleven formats.",
  },
];

export function Phases(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <View style={s.section} {...sectionAnchor("how-it-works")}>
      <Label>How it works</Label>
      <Text style={s.heading}>{PHASES_HEADING}</Text>
      <View style={s.grid}>
        {PHASES.map((p) => (
          <Card key={p.num} style={s.card}>
            <Text style={s.num}>{p.num}</Text>
            <Text style={s.name}>{p.name}</Text>
            <Text style={s.body}>{p.body}</Text>
            <Text style={s.youGet}>
              <Text style={s.youGetLabel}>You get: </Text>
              {p.youGet}
            </Text>
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
  youGet: {
    color: t.textMuted,
    fontSize: typography.sizeXs,
    lineHeight: typography.sizeXs * typography.lineHeightNormal,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  youGetLabel: {
    color: t.primary,
    fontWeight: "600" as const,
  },
});
