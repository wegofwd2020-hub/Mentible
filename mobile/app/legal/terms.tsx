import React from "react";
import { ScrollView, Text, View } from "react-native";
import { OPERATOR_NAME } from "@/components/landing/LandingFooter";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// DRAFT terms of use. NOT final: it must be reviewed by a qualified lawyer before
// publication. The bracketed text is a placeholder, not legal wording.
export default function TermsDraftScreen(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      <View style={s.banner} accessibilityRole="alert">
        <Text style={s.bannerText}>DRAFT — pending legal review. Not final.</Text>
      </View>
      <Text style={s.title}>Terms of use</Text>
      <Text style={s.body}>Operator: {OPERATOR_NAME}, Michigan, USA.</Text>
      <Text style={s.body}>
        [Draft section — to be written and reviewed by a qualified lawyer. Known facts to
        cover: the service is in pilot; no price or guarantee is offered yet; generated
        content is draft-grade until a named expert approves it.]
      </Text>
    </ScrollView>
  );
}

const make = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  content: { padding: spacing.lg, gap: spacing.md },
  banner: {
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: 8,
    padding: spacing.sm,
  },
  bannerText: { color: c.warning, fontWeight: "700" as const, fontSize: typography.sizeSm },
  title: { fontSize: typography.sizeLg, color: c.text, fontWeight: "700" as const },
  body: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 21 },
});
