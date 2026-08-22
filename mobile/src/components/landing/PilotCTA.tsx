import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Card } from "@/components/ui/Card";
import { useThemedStyles } from "@/theme";
import { FRAUNCES } from "@/constants/fonts";
import { spacing, radius, typography, type Palette } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

export function PilotCTA(): React.JSX.Element {
  const s = useThemedStyles(make);
  const router = useRouter();
  return (
    <View style={s.section} {...sectionAnchor("pricing")}>
      <Card style={s.card}>
        <Text style={s.heading}>Publish your first asset in a focused sprint.</Text>
        <Text style={s.body}>
          A short book or guide plus reusable derivatives, an expert-approval record, and
          source traceability.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={s.cta}
          onPress={() => router.push("/work-with-me")}
        >
          <Text style={s.ctaText}>Become a design partner</Text>
        </Pressable>
      </Card>
    </View>
  );
}

const make = (t: Palette) => ({
  section: {
    paddingHorizontal: spacing.lg,
  },
  card: {
    gap: spacing.md,
    alignItems: "flex-start" as const,
  },
  heading: {
    fontFamily: FRAUNCES.regular,
    fontSize: typography.sizeXl,
    color: t.text,
  },
  body: {
    color: t.textSecondary,
    fontSize: typography.sizeMd,
    lineHeight: typography.sizeMd * typography.lineHeightRelaxed,
    maxWidth: 560,
  },
  cta: {
    backgroundColor: t.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  ctaText: {
    color: t.primaryText,
    fontWeight: "600" as const,
    fontSize: typography.sizeSm,
  },
});
