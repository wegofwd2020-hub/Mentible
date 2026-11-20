import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { useManagedStatus } from "@/hooks/useManagedStatus";
import { limitHits } from "@/billing/limits";
import { useThemedStyles } from "@/theme";

// Explicit "you've reached a limit" message for generate and regenerate screens.
// Renders nothing when no limit is reached (or the status is unknown), so it never
// blocks a screen on a failed fetch. Shows the upgrade action for Free users.
export function LimitBanner(): React.JSX.Element | null {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { plan } = useBillingPlan();
  const { status: managed } = useManagedStatus();

  const hits = limitHits(plan, managed);
  if (hits.length === 0) return null;

  const showUpgrade = plan !== null && !plan.is_pro;

  return (
    <View style={styles.box} accessibilityRole="alert">
      {hits.map((h) => (
        <Text key={h.key} style={styles.text}>
          {h.message}
        </Text>
      ))}
      {showUpgrade ? (
        <Pressable
          onPress={() => router.push("/paywall")}
          accessibilityRole="button"
          accessibilityLabel="Upgrade to Pro"
          style={styles.btn}
        >
          <Text style={styles.btnText}>Upgrade to Pro</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  box: {
    backgroundColor: c.surface,
    borderColor: c.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    gap: spacing.xs,
  },
  text: {
    color: c.text,
    fontSize: typography.sizeSm,
  },
  btn: {
    alignSelf: "flex-start" as const,
    marginTop: spacing.xs,
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  btnText: {
    color: c.primaryText,
    fontWeight: "700" as const,
    fontSize: typography.sizeSm,
  },
});
