import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { EntitlementStatus, ManagedStatus } from "@/api/billingClient";
import { colors, radius, spacing } from "@/constants/theme";

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

export function ManagedPlanCard({ status }: { status: ManagedStatus }) {
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
                { width: `${pct}%`, backgroundColor: overCap ? colors.warning : colors.brand },
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
        <Text style={styles.warn}>
          Your managed plan has ended. Generation falls back to your own key (BYOK).
        </Text>
      )}
      {overCap && ent.status === "active" && (
        <Text style={styles.warn}>
          You’ve used your allowance for this period. Add your own key (BYOK) or wait for
          renewal.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  plan: { color: colors.text, fontSize: 18, fontWeight: "700" },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeActive: { backgroundColor: colors.brand + "22" },
  badgeWarn: { backgroundColor: colors.warning + "22" },
  badgeText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  meterText: { color: colors.text, fontSize: 14 },
  meterTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  meterFill: { height: 8, borderRadius: 4 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
});
