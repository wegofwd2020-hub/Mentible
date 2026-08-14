import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Button, Card, Label } from "@/components/ui";
import { BRAND_CONTACT } from "@/constants/brand";
import { FRAUNCES } from "@/constants/fonts";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// Build-time config (baked like EXPO_PUBLIC_API_BASE_URL). Placeholder default so the
// build never breaks; the owner sets the real Calendly/Cal.com event URL at deploy.
export const SCHEDULER_URL: string =
  process.env.EXPO_PUBLIC_SCHEDULER_URL ?? "https://calendly.com/REPLACE_ME/30min";

const TIERS: { title: string; body: string }[] = [
  { title: "Discovery", body: "A scoped conversation to map your expertise and pick a first artifact." },
  { title: "Sprint", body: "A fixed-scope engagement producing one expert-validated, traceable asset." },
  { title: "Pilot", body: "A longer run standing up your validation workflow across several assets." },
];

const PHASES = ["Capture", "Create", "Validate", "Share"];

export default function WorkWithMeScreen() {
  const styles = useThemedStyles(makeStyles);
  const bookCall = () => { void Linking.openURL(SCHEDULER_URL); };
  const emailMe = () =>
    void Linking.openURL(`mailto:${BRAND_CONTACT}?subject=${encodeURIComponent("Mentible — work with me")}`);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <View style={styles.content}>
          {/* Hero */}
          <Text style={styles.h1}>Work with me: turn your expertise into validated, traceable knowledge</Text>
          <Text style={styles.subhead}>
            I help subject-matter experts capture what they know and turn it into expert-validated,
            traceable assets — a four-phase loop: Capture, Create, Validate, Share.
          </Text>

          {/* Engagement types */}
          <Text style={styles.h2}>Ways to work together</Text>
          <View style={styles.tiers}>
            {TIERS.map((t) => (
              <Card key={t.title} style={styles.tier}>
                <Text style={styles.tierTitle}>{t.title}</Text>
                <Text style={styles.tierBody}>{t.body}</Text>
              </Card>
            ))}
          </View>

          {/* How it works */}
          <Text style={styles.h2}>How it works</Text>
          <View style={styles.phases}>
            {PHASES.map((p, i) => (
              <View key={p} style={styles.phase}>
                <Text style={styles.phaseText}>{p}</Text>
                {i < PHASES.length - 1 ? <Text style={styles.phaseArrow}>→</Text> : null}
              </View>
            ))}
          </View>

          {/* Who it's for */}
          <Text style={styles.h2}>Who it's for</Text>
          <Text style={styles.subhead}>
            Practitioners with hard-won, defensible expertise who want it written down, refined,
            and signed off — not generic AI content. If that's you, let's talk.
          </Text>

          {/* Book */}
          <Label tone="secondary">Booking asks a couple of quick questions so I can prep.</Label>
          <Button
            variant="primary"
            label="Book a 30-minute conversation"
            onPress={bookCall}
            accessibilityLabel="Book a 30-minute conversation"
            style={styles.book}
          />
          <Pressable onPress={emailMe} accessibilityRole="button" accessibilityLabel="Email me instead" style={styles.mailto}>
            <Text style={styles.mailtoText}>Prefer email? Reach me directly.</Text>
          </Pressable>
        </View>
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  body: { padding: spacing.md },
  content: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const, gap: spacing.md },
  h1: { color: c.text, fontFamily: FRAUNCES.bold, fontSize: typography.sizeXxl, letterSpacing: -0.5 },
  h2: { color: c.text, fontFamily: FRAUNCES.bold, fontSize: typography.sizeXl, marginTop: spacing.md },
  subhead: { color: c.textSecondary, fontSize: typography.sizeMd, lineHeight: 24 },
  tiers: { gap: spacing.sm },
  tier: { gap: spacing.xs },
  tierTitle: { color: c.text, fontSize: typography.sizeLg, fontWeight: "600" as const },
  tierBody: { color: c.textSecondary, fontSize: typography.sizeSm, lineHeight: 21 },
  phases: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.xs },
  phase: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  phaseText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  phaseArrow: { color: c.textMuted, fontSize: typography.sizeMd },
  book: { alignSelf: "flex-start" as const, borderRadius: radius.full, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  mailto: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  mailtoText: { color: c.textMuted, fontSize: typography.sizeSm },
});
