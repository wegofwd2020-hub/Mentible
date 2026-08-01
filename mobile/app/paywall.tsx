import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getPurchaseController, usePlanOffers } from "@/billing";
import type { PlanOffer } from "@/billing";
import { PageContainer } from "@/components/PageContainer";
import { PlanCard } from "@/components/PlanCard";
import { HelpButton } from "@/help";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// The Plans screen. Two key-custody paths side by side: Managed (we hold the provider
// key and carry token cost under an allowance) and BYOK (you pay your provider direct).
//
// Two rules this screen exists to keep, both enforced by __tests__/screens/Paywall.test.tsx:
//  1. The CTA label and the renewal-terms line ALWAYS describe the selected plan.
//  2. A user backing out of the store sheet is not an error and shows nothing.
//
// No Alert anywhere — RN-web no-ops that API and this ships to /app/mentible.

// Storage, not tokens: "unlimited" here means Library capacity. Never say it about
// managed generation — plans.py's uncapped tier is an open-ended token liability.
const BENEFITS = [
  "Unlimited books in your Library",
  "EPUB3 + PDF export",
  "Diagrams, math, quizzes",
  "Cancel any time in Google Play",
] as const;

function ctaLabel(offer: PlanOffer): string {
  return offer.kind === "managed" ? "Start with Managed" : "Start with your own key";
}

type Action = { kind: "idle" } | { kind: "purchasing" } | { kind: "notice"; message: string };

export default function PaywallScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { state, reload } = usePlanOffers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>({ kind: "idle" });

  const offers = state.kind === "ready" ? state.offers : [];

  // Managed is the default — ADR-005 D1's stated default, and the tier that costs *us*
  // tokens. Defaulting against our own margin is the right default for a user with no key.
  const selected = useMemo(
    () =>
      offers.find((o) => o.id === selectedId) ??
      offers.find((o) => o.kind === "managed") ??
      offers[0],
    [offers, selectedId],
  );

  const run = async (fn: () => Promise<import("@/billing").PurchaseResult>) => {
    setAction({ kind: "purchasing" });
    const result = await fn();
    if (result.kind === "cancelled") {
      // The user backed out. Not an error. Say nothing.
      setAction({ kind: "idle" });
      return;
    }
    if (result.kind === "unavailable") {
      setAction({ kind: "notice", message: result.reason });
      return;
    }
    // "purchased" means the store took money — NOT that the entitlement is live. That
    // arrives out-of-band via the RevenueCat webhook, so we go back and let the Usage
    // screen re-read GET /billing/managed-status rather than trusting the client.
    setAction({ kind: "idle" });
    router.back();
  };

  if (state.kind === "loading") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          <ActivityIndicator color={theme.brand} accessibilityLabel="loading plans" />
        </PageContainer>
      </ScrollView>
    );
  }

  if (state.kind === "error") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          <Text style={styles.error} accessibilityLabel="error">
            {state.message}
          </Text>
          <Pressable style={styles.cta} onPress={reload} accessibilityRole="button">
            <Text style={styles.ctaText}>Retry</Text>
          </Pressable>
        </PageContainer>
      </ScrollView>
    );
  }

  const busy = action.kind === "purchasing";

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <HelpButton topic="plans" label="Plans & billing" />

        {/* Preview banner — same border-left "read this before you trust what
            follows" idiom as usage.tsx's disclaimer. This screen shows placeholder
            prices and can't take a real purchase yet; say so before the pitch. */}
        <View style={styles.previewBanner} accessibilityLabel="preview banner">
          <Text style={styles.previewBannerText}>
            Preview — paid plans aren't purchasable yet. Bring-your-own-key works today.
          </Text>
        </View>

        <Text style={styles.h1}>Generate books with your key or ours</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow} accessibilityLabel="benefit">
              <Text style={styles.tick}>✓</Text>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.cards} accessibilityRole="radiogroup">
          {offers.map((offer) => (
            <PlanCard
              key={offer.id}
              offer={offer}
              selected={selected?.id === offer.id}
              onSelect={setSelectedId}
            />
          ))}
        </View>

        {selected && (
          <>
            {/* Store policy: price + period + renewal, adjacent to the purchase button. */}
            <Text style={styles.terms} accessibilityLabel="renewal terms">
              {selected.renewalTerms}
            </Text>

            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              disabled={busy}
              onPress={() => void run(() => getPurchaseController().purchase(selected.id))}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={theme.brandText} />
              ) : (
                <Text style={styles.ctaText}>{ctaLabel(selected)}</Text>
              )}
            </Pressable>
          </>
        )}

        {action.kind === "notice" && (
          <Text style={styles.notice} accessibilityLabel="notice">
            {action.message}
          </Text>
        )}

        <View style={styles.footer}>
          <Pressable
            onPress={() => void run(() => getPurchaseController().restore())}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.footerLink}>Restore</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => router.push("/about")} accessibilityRole="link">
            <Text style={styles.footerLink}>Terms</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => router.push("/about")} accessibilityRole="link">
            <Text style={styles.footerLink}>Privacy policy</Text>
          </Pressable>
        </View>
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 as const },
  previewBanner: {
    backgroundColor: c.surface,
    borderLeftWidth: 3,
    borderLeftColor: c.warning,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  previewBannerText: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  h1: {
    color: c.text,
    fontSize: typography.sizeXl,
    fontFamily: typography.fontHeading,
    lineHeight: 30,
  },
  benefits: { gap: spacing.sm },
  benefitRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  tick: { color: c.growth, fontSize: typography.sizeMd, fontWeight: "700" as const },
  benefitText: { color: c.text, fontSize: typography.sizeSm },
  cards: { gap: spacing.sm },
  terms: { color: c.textMuted, fontSize: typography.sizeXs, lineHeight: 18 },
  cta: {
    backgroundColor: c.brand,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: c.brandText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  notice: { color: c.textSecondary, fontSize: typography.sizeSm, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeSm },
  footer: {
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  footerLink: { color: c.textMuted, fontSize: typography.sizeXs },
  footerDot: { color: c.textMuted, fontSize: typography.sizeXs },
});
