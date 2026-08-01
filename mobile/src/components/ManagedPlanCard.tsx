import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { EntitlementStatus, ManagedStatus } from "@/api/billingClient";
import { radius, spacing, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// Server-sourced managed-plan status for a signed-in user (ADR-005 D6, Phase 5).
// Shows the current plan + status and a usage meter against the plan allowance —
// the managed counterpart to the device-local BYOK ledger below it on the Usage
// screen. Purchase/upgrade (the RevenueCat flow) is a later slice; this is read-only.

function microsToUsd(m: number): string {
  if (m > 0 && m < 10_000) return "<$0.01"; // under one cent
  return `$${(m / 1_000_000).toFixed(2)}`;
}

const STATUS_LABEL: Record<EntitlementStatus, string> = {
  active: "Active",
  past_due: "Payment issue",
  canceled: "Ended",
};

// Shown where a plan would actually help: no entitlement (BYOK upsell), an ended plan,
// or a spent allowance. Never on a healthy active plan — paying users don't get nagged.
function SeePlansLink({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/paywall")} accessibilityRole="link">
      <Text style={styles.link}>See plans</Text>
    </Pressable>
  );
}

export function ManagedPlanCard({ status }: { status: ManagedStatus }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ent = status.entitlement;
  const used = status.usage.cost_micros;
  const usedUsd = microsToUsd(used);

  // No managed plan ⇒ the user is on BYOK; say so plainly.
  if (!ent) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Managed plan</Text>
        <Text style={styles.body}>
          You’re on bring-your-own-key — generation uses your own provider keys. No
          managed plan or allowance.
        </Text>
        <SeePlansLink styles={styles} />
      </View>
    );
  }

  const allowance = status.allowance_micros ?? 0;
  const unlimited = allowance <= 0;
  const overCap = !unlimited && used >= allowance;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / allowance) * 100));
  const badgeStyle =
    ent.status === "active" ? styles.badgeActive : styles.badgeWarn;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.plan}>{ent.plan_display}</Text>
        <View style={[styles.badge, badgeStyle]}>
          <Text style={styles.badgeText}>{STATUS_LABEL[ent.status]}</Text>
        </View>
      </View>

      {unlimited ? (
        <Text style={styles.meterText}>{usedUsd} used · unlimited this period</Text>
      ) : (
        <>
          <Text style={styles.meterText}>
            {usedUsd} of {microsToUsd(allowance)} used
          </Text>
          <View style={styles.meterTrack} accessibilityLabel={`${pct}% of allowance used`}>
            <View
              style={[
                styles.meterFill,
                { width: `${pct}%`, backgroundColor: overCap ? theme.warning : theme.brand },
              ]}
            />
          </View>
        </>
      )}

      {ent.status === "past_due" && (
        <Text style={styles.warn}>
          There’s a payment issue with your subscription. Update it to keep managed
          generation.
        </Text>
      )}
      {ent.status === "canceled" && (
        <>
          <Text style={styles.warn}>
            Your managed plan has ended. Generation falls back to your own key (BYOK).
          </Text>
          <SeePlansLink styles={styles} />
        </>
      )}
      {overCap && ent.status === "active" && (
        <>
          <Text style={styles.warn}>
            You’ve used your allowance for this period. Add your own key (BYOK) or wait for
            renewal.
          </Text>
          <SeePlansLink styles={styles} />
        </>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: {
    color: c.textMuted,
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  body: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  head: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  plan: { color: c.text, fontSize: 18, fontWeight: "700" as const },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeActive: { backgroundColor: c.brand + "22" },
  badgeWarn: { backgroundColor: c.warning + "22" },
  badgeText: { color: c.text, fontSize: 12, fontWeight: "600" as const },
  meterText: { color: c.text, fontSize: 14 },
  meterTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: c.border,
    overflow: "hidden" as const,
  },
  meterFill: { height: 8, borderRadius: 4 },
  warn: { color: c.warning, fontSize: 13, lineHeight: 19 },
  link: { color: c.brand, fontSize: 14, fontWeight: "600" as const },
});
