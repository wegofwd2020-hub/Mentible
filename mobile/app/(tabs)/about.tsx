import React from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { BRAND_AUTHOR, BRAND_CONTACT, BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { Card, Label } from "@/components/ui";
import { QUALITY_GATE_LIBS } from "@/constants/qualityGateLibs";
import { buildLabel } from "@/lib/buildInfo";
import { providerInfo } from "@/constants/providers";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";

// The default GENERATION engine, human-readable. Provider is sourced from the
// seam (follows automatically if the default provider changes); the model name
// is the only literal (backend groq_default_model — one-line update if it moves).
// NOT hardcoded to a single model like the old "claude-sonnet-4-6" which silently
// drifted when the default changed.
const DEFAULT_MODEL_LABEL = `Qwen 3.8 · ${providerInfo(DEFAULT_GENERATION_PARAMS.provider).label} — or your own key`;

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
        {BRAND_NAME} turns your expertise into expert-validated, traceable
        knowledge — capture your sources, draft with AI, validate it, and share.
        Start free with a built-in model, or bring your own key (Claude and
        others). Your content stays yours.
      </Text>

      <View style={styles.section}>
        <Label tone="secondary">About this app</Label>
        <Card style={styles.cardInner}>
          <Row label="App" value={BRAND_NAME} styles={styles} />
          <Row label="Tagline" value={BRAND_TAGLINE} styles={styles} />
          <Row label="Version" value={buildLabel()} styles={styles} />
          <Row label="Default model" value={DEFAULT_MODEL_LABEL} styles={styles} />
        </Card>
      </View>

      <View style={styles.section}>
        <Label tone="secondary">Quality-gate libraries</Label>
        <Card style={styles.cardInner}>
          <Text style={styles.body}>
            The libraries that validate, sanitize, render, and export your
            content — the tools behind each project's quality gates.
          </Text>
          {QUALITY_GATE_LIBS.map((lib) => (
            <LibRow key={lib.name} name={lib.name} version={lib.version} role={lib.role} styles={styles} />
          ))}
          <Text style={styles.footnote}>
            Versions are curated; the gates run server-side.
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <Label tone="secondary">Author</Label>
        <Card style={styles.cardInner}>
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
        </Card>
      </View>

      <View style={styles.section}>
        <Label tone="secondary">Privacy</Label>
        <Card style={styles.cardInner}>
          <Text style={styles.body}>
            Your API key and your lessons are yours. The key is held in
            your device's secure storage and used only to generate your content — never
            logged or stored on a server.
          </Text>
        </Card>
      </View>

      <Text style={styles.footnote}>
        Brand name provisional, pending trademark clearance.
      </Text>
      </PageContainer>
    </ScrollView>
  );
}

function LibRow({
  name,
  version,
  role,
  styles,
}: {
  name: string;
  version: string;
  role: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.libRow} accessibilityLabel={`${name} ${version} — ${role}`}>
      <View style={styles.libLeft}>
        <Text style={styles.libName}>{name}</Text>
        <Text style={styles.libRole}>{role}</Text>
      </View>
      <Text style={styles.libVersion}>{version}</Text>
    </View>
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
  scroll: { flex: 1, backgroundColor: "transparent" },
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
  // Layout only — the surface, border, and padding now come from <Card>.
  cardInner: { gap: spacing.sm },
  body: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 21 },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  rowLabel: { fontSize: typography.sizeSm, color: c.textMuted },
  rowValue: { fontSize: typography.sizeSm, color: c.text, fontWeight: "500" as const },
  contactValue: { fontSize: typography.sizeSm, color: c.primary, fontWeight: "500" as const },
  libRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
    gap: spacing.sm,
  },
  libLeft: { flex: 1, gap: 2 },
  libName: { fontSize: typography.sizeSm, color: c.text, fontWeight: "600" as const },
  libRole: { fontSize: typography.sizeXs, color: c.textMuted, lineHeight: 16 },
  libVersion: {
    fontSize: typography.sizeSm,
    color: c.textSecondary,
    fontWeight: "500" as const,
    fontVariant: ["tabular-nums" as const],
  },
  footnote: {
    fontSize: typography.sizeXs,
    color: c.textMuted,
    textAlign: "center" as const,
    marginTop: spacing.sm,
  },
});
