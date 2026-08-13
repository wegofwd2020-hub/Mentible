// Compact, pure-presentational managed-plan quota indicator for the app chrome
// (ADR-005 D6 managed billing). Takes the already-fetched `ManagedStatus` — no
// fetching of its own, see `useManagedStatus`. Renders nothing for a BYOK user
// (no entitlement).

import React from "react";
import { Text, View } from "react-native";
import { type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { type ManagedStatus } from "@/api/billingClient";

type Level = "ok" | "warn" | "over" | "unlimited";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function UsageMeterPill({ status }: { status: ManagedStatus }): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const { entitlement, usage, allowance_micros: allowanceMicros } = status;

  if (entitlement === null) return null;

  const pct = allowanceMicros !== null && allowanceMicros > 0
    ? clamp(usage.cost_micros / allowanceMicros, 0, 1)
    : 0;
  const level: Level =
    allowanceMicros === 0 ? "unlimited" : pct >= 1 ? "over" : pct >= 0.8 ? "warn" : "ok";

  const used = formatUsd(usage.cost_micros);
  const label =
    level === "unlimited"
      ? `${entitlement.plan_display} · ${used} · unlimited`
      : `${entitlement.plan_display} · ${used} / ${formatUsd(allowanceMicros ?? 0)}`;

  return (
    <View
      testID={`usage-meter-pill-${level}`}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: false }}
      style={[styles.pill, (level === "warn" || level === "over") && styles.pillAlert]}
    >
      <Text style={[styles.label, level === "over" && styles.labelOver, level === "warn" && styles.labelWarn]}>
        {label}
      </Text>
      {level !== "unlimited" && (
        <View style={styles.track}>
          <View
            testID="usage-meter-bar"
            style={[
              styles.fill,
              { width: `${pct * 100}%` },
              level === "warn" && styles.fillWarn,
              level === "over" && styles.fillOver,
            ]}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  pillAlert: {
    borderColor: c.warning,
  },
  label: {
    fontSize: 12,
    color: c.textMuted,
  },
  labelWarn: {
    color: c.warning,
  },
  labelOver: {
    color: c.error,
  },
  track: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    overflow: "hidden" as const,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: c.primary,
  },
  fillWarn: {
    backgroundColor: c.warning,
  },
  fillOver: {
    backgroundColor: c.error,
  },
});
