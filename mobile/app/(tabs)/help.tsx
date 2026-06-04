import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Help / getting-started screen. Scaffolded content — refine copy as the product
// firms up. Reachable from the top nav (Help tile).
export default function HelpScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
      <Text style={styles.title}>Help</Text>

      <Section title="Getting started">
        <Step n={1} text="Add your Anthropic API key in Settings (stored only on your device)." />
        <Step n={2} text="On Query, describe what you want to learn and set the scope." />
        <Step n={3} text="Generate — your lesson is rendered with math, diagrams and tables." />
        <Step n={4} text="Save lessons to your Library, or open compiled books under Books." />
      </Section>

      <Section title="Your Anthropic key (BYOK)">
        <Text style={styles.body}>
          Mentible is bring-your-own-key: you pay Anthropic directly. Your key is
          kept in the device keystore and sent per request to generate content —
          it is never logged or stored on a server.
        </Text>
        <Pressable
          style={styles.linkBtn}
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel="Open Settings to add your key"
        >
          <Text style={styles.linkBtnText}>Open Settings →</Text>
        </Pressable>
      </Section>

      <Section title="How scoped queries work">
        <Text style={styles.body}>
          Mentible isn&apos;t a chatbot. Every generation is a scoped query tuned
          by a few dimensions — level, depth, length and diagram register — so you
          get a real lesson, not a chat reply. Adjust the scope to change the
          reading level, how deep it goes, and the kind of diagrams it produces.
        </Text>
      </Section>

      <Section title="Diagram types">
        <Text style={styles.body}>
          The Diagrams setting controls what kind of visuals you get — from
          big-idea infographics to precise technical diagrams. Browse examples to
          pick the direction that fits your audience.
        </Text>
        <Pressable
          style={styles.linkBtn}
          onPress={() => router.push("/diagram-types")}
          accessibilityRole="button"
          accessibilityLabel="Browse diagram types"
        >
          <Text style={styles.linkBtnText}>Browse diagram types →</Text>
        </Pressable>
      </Section>

      <Section title="Formats">
        <Text style={styles.body}>
          At launch, generations are lessons. Saved content can be compiled into
          EPUB/PDF books with a branded cover, figures, tables and a glossary.
        </Text>
      </Section>
      </PageContainer>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  title: {
    fontSize: typography.sizeXl,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.xs,
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
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary + "33",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeXs },
  stepText: { flex: 1, fontSize: typography.sizeSm, color: colors.text, lineHeight: 21 },
  linkBtn: { alignSelf: "flex-start" },
  linkBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
});
