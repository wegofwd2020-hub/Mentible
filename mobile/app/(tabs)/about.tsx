import React from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { BRAND_AUTHOR, BRAND_CONTACT, BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// About screen — brand blurb + app facts. Scaffolded content; refine as needed.
export default function AboutScreen() {
  const styles = useThemedStyles(makeStyles);
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
          <Row label="App" value={BRAND_NAME} styles={styles} />
          <Row label="Tagline" value={BRAND_TAGLINE} styles={styles} />
          <Row label="Version" value="0.1.0 (MVP)" styles={styles} />
          <Row label="Default model" value="claude-sonnet-4-6" styles={styles} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Author</Text>
        <View style={styles.card}>
          <Row label="Author" value={BRAND_AUTHOR} styles={styles} />
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
            Your API key and your lessons are yours. The key is held in
            your device's secure storage and used only to generate your content — never
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

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 },
  brandHeader: { alignItems: "center" as const, paddingTop: spacing.sm },
  brandCard: {
    alignSelf: "center" as const,
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandLogo: { width: 150, height: 150 },
  blurb: {
    fontSize: typography.sizeMd,
    color: c.textSecondary,
    lineHeight: 23,
    textAlign: "center" as const,
  },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  body: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 21 },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  rowLabel: { fontSize: typography.sizeSm, color: c.textMuted },
  rowValue: { fontSize: typography.sizeSm, color: c.text, fontWeight: "600" as const },
  contactValue: { fontSize: typography.sizeSm, color: c.primary, fontWeight: "600" as const },
  footnote: {
    fontSize: typography.sizeXs,
    color: c.textMuted,
    textAlign: "center" as const,
    marginTop: spacing.sm,
  },
});
