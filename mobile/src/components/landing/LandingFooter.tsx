import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// Operator identity + legal links for the public landing page. The contact address
// is deliberately a placeholder: it must be confirmed by the owner before launch
// (see the site-actions brief, Task 4). Legal pages are DRAFTS pending legal review.
export const OPERATOR_NAME = "Kaundinya Labs LLC";
export const CONTACT_PLACEHOLDER = "[Contact email: pending owner confirmation]";

export function LandingFooter(): React.JSX.Element {
  const s = useThemedStyles(make);
  const router = useRouter();

  return (
    <View style={s.footer}>
      <Text style={s.operator}>{OPERATOR_NAME} · Michigan, USA</Text>
      <Text style={s.body}>{CONTACT_PLACEHOLDER}</Text>
      <View style={s.links}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Privacy policy (draft, pending legal review)"
          onPress={() => router.push("/legal/privacy" as Href)}
        >
          <Text style={s.link}>Privacy policy (draft)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Terms of use (draft, pending legal review)"
          onPress={() => router.push("/legal/terms" as Href)}
        >
          <Text style={s.link}>Terms of use (draft)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const make = (c: Palette) => ({
  footer: {
    borderTopWidth: 1,
    borderColor: c.border,
    paddingTop: spacing.lg,
    gap: spacing.xs,
  },
  operator: { fontSize: typography.sizeSm, color: c.text, fontWeight: "600" as const },
  body: { fontSize: typography.sizeSm, color: c.textMuted },
  links: { flexDirection: "row" as const, gap: spacing.lg, marginTop: spacing.xs },
  link: { fontSize: typography.sizeSm, color: c.primary, textDecorationLine: "underline" as const },
});
