import React from "react";
import { ScrollView, Text, View } from "react-native";
import { OPERATOR_NAME } from "@/components/landing/LandingFooter";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// DRAFT privacy policy. NOT final: it must be reviewed by a qualified lawyer before
// publication. Sections below record what the product is known to do, so the reviewer
// has a starting point; they are not legal wording.
export default function PrivacyDraftScreen(): React.JSX.Element {
  const s = useThemedStyles(make);
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      <View style={s.banner} accessibilityRole="alert">
        <Text style={s.bannerText}>DRAFT — pending legal review. Not final.</Text>
      </View>
      <Text style={s.title}>Privacy policy</Text>
      <Text style={s.body}>Operator: {OPERATOR_NAME}, Michigan, USA.</Text>
      <Text style={s.body}>
        [Draft section — to be written and reviewed by a qualified lawyer. Known facts to
        cover: account sign-in through an external identity provider; your provider API
        keys are stored on your device unless you opt into managed keys; managed usage is
        metered; account deletion and data retention schedule.]
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
