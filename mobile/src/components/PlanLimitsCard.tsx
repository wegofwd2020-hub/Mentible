import React from "react";
import { Linking, Text, View } from "react-native";
import type { PlanStatus } from "@/api/billingClient";
import { BRAND_CONTACT } from "@/constants/brand";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { Button, Label } from "@/components/ui";

// Free/Pro plan limits + upgrade surface (T4). Server-sourced (useBillingPlan,
// T1) — read-only; the caps/usage shown here are the same numbers the server
// enforces at the 3 gate sites (POST /projects, the 3 trust-generate submits).
// There is NO payment rail yet (Slice C, deferred) — the CTA explains the
// operator-grant path (a contact email), never a checkout.
//
// Guards for plan:null (still loading, signed out, or a failed billing fetch)
// by rendering nothing — this card is informational only, never a wall, so
// there is nothing to fail open ON here (contrast the generate/create caps,
// which fail open by not disabling).
export function PlanLimitsCard({ plan, loading }: { plan: PlanStatus | null; loading: boolean }): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);

  if (!plan) {
    return loading ? (
      <View style={styles.card}>
        <Text style={styles.loadingText}>Loading plan…</Text>
      </View>
    ) : null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Label tone="secondary">Plan</Label>
        <View style={[styles.badge, plan.is_pro ? styles.badgePro : styles.badgeFree]}>
          <Text style={styles.badgeText}>{plan.is_pro ? "Pro" : "Free"}</Text>
        </View>
      </View>

      <View style={styles.meterRow}>
        <Text style={styles.meterText}>
          Projects: {plan.usage.projects} / {plan.caps.max_projects}
        </Text>
        <Text style={styles.meterText}>
          Generations: {plan.usage.generations} / {plan.caps.max_generations} (last {plan.caps.gen_window_days}d)
        </Text>
      </View>

      {plan.is_pro ? (
        <Text style={styles.body}>You&apos;re on Pro — no caps on projects or generations, and EPUB/PDF export is unlocked.</Text>
      ) : (
        <>
          <Text style={styles.body}>
            Free plans are capped on active projects and generations, and EPUB/PDF export is a
            Pro feature. Upgrade to Pro to remove the caps.
          </Text>
          <Button
            variant="primary"
            label="Upgrade to Pro"
            onPress={() => void Linking.openURL(`mailto:${BRAND_CONTACT}?subject=${encodeURIComponent("Upgrade to Pro")}`)}
            accessibilityLabel="Upgrade to Pro"
            style={styles.upgradeBtn}
          />
          <Text style={styles.note}>
            There&apos;s no self-serve checkout yet — Pro is granted by the operator. Contact us to
            upgrade.
          </Text>
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
  loadingText: { color: c.textMuted, fontSize: typography.sizeSm },
  head: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgePro: { backgroundColor: c.growth + "22" },
  badgeFree: { backgroundColor: c.surfaceHigh },
  badgeText: { color: c.text, fontSize: typography.sizeXs, fontWeight: "600" as const },
  meterRow: { gap: spacing.xs },
  meterText: { color: c.text, fontSize: typography.sizeSm },
  body: { color: c.textMuted, fontSize: typography.sizeSm, lineHeight: 19 },
  upgradeBtn: { alignSelf: "flex-start" as const },
  note: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const },
});
