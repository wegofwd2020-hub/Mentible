import React from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BRAND_AUTHOR, BRAND_CONTACT, BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";

// About screen — brand blurb + app facts. Scaffolded content; refine as needed.
export default function AboutScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
      <View style={styles.brandHeader}>
        <View style={styles.brandCard}>
          <Image
            source={require("../../assets/brand/mentible-lockup-redorange-white.png")}
            style={styles.brandLogo}
            resizeMode="contain"
            accessibilityLabel={`${BRAND_NAME} — ${BRAND_TAGLINE}`}
          />
        </View>
      </View>

      <Text style={styles.blurb}>
        {BRAND_NAME} is a purpose-built learning client for self-learners. Describe
        what you want to learn, set the scope, and get a rendered lesson — not a
        chat reply. Bring your own Anthropic key; your content stays yours.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>About this app</Text>
        <View style={styles.card}>
          <Row label="App" value={BRAND_NAME} />
          <Row label="Tagline" value={BRAND_TAGLINE} />
          <Row label="Version" value="0.1.0 (MVP)" />
          <Row label="Default model" value="claude-sonnet-4-6" />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Author</Text>
        <View style={styles.card}>
          <Row label="Author" value={BRAND_AUTHOR} />
          <Pressable
            style={styles.row}
            onPress={() => Linking.openURL(`mailto:${BRAND_CONTACT}`)}
            accessibilityRole="link"
            accessibilityLabel={`Email ${BRAND_CONTACT}`}
          >
            <Text style={styles.rowLabel}>Contact</Text>
            <Text style={styles.contactValue}>{BRAND_CONTACT}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Privacy</Text>
        <View style={styles.card}>
          <Text style={styles.body}>
            Your Anthropic API key and your lessons are yours. The key is held in
            the device keystore and used only to generate your content — never
            logged or stored on a server.
          </Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        Brand name provisional, pending trademark clearance.
      </Text>
      </PageContainer>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  brandHeader: { alignItems: "center", paddingTop: spacing.sm },
  brandCard: {
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandLogo: { width: 150, height: 150 },
  blurb: {
    fontSize: typography.sizeMd,
    color: colors.textSecondary,
    lineHeight: 23,
    textAlign: "center",
  },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  body: { fontSize: typography.sizeSm, color: colors.textSecondary, lineHeight: 21 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { fontSize: typography.sizeSm, color: colors.textMuted },
  rowValue: { fontSize: typography.sizeSm, color: colors.text, fontWeight: "600" },
  contactValue: { fontSize: typography.sizeSm, color: colors.primary, fontWeight: "600" },
  footnote: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
