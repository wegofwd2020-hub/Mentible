import React from "react";
import { Text, View } from "react-native";
import { PROVIDERS } from "@/constants/providers";
import { radius, spacing, type Palette } from "@/constants/theme";
import type { ModelUsage } from "@/storage/usageStore";
import { useThemedStyles } from "@/theme";

// Self-service "which LLMs do I have, and how" card (Usage screen). Answers the
// user's real question — for each provider we offer, is it available on their
// managed plan, do they have their own BYOK key on this device, or neither — plus
// this device's generation count for it. Two honest sources: `managedProviders`
// is server truth (the same gate the generate path uses); `savedProviders` is
// device-local (ADR-001 — BYOK keys never leave the device), so BYOK access and
// usage are per-device, not cross-device or the provider's real invoice.

function aggregateByProvider(byModel: ModelUsage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of byModel) out[m.provider] = (out[m.provider] ?? 0) + m.generations;
  return out;
}

export function ProvidersAccessCard({
  managedProviders,
  savedProviders,
  byModel,
}: {
  managedProviders: string[];
  savedProviders: string[];
  byModel: ModelUsage[];
}) {
  const styles = useThemedStyles(makeStyles);
  const managed = new Set(managedProviders);
  const byok = new Set(savedProviders);
  const gens = aggregateByProvider(byModel);

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Your providers</Text>
      {PROVIDERS.map((p) => {
        const isManaged = managed.has(p.id);
        const isByok = byok.has(p.id);
        const count = gens[p.id] ?? 0;
        return (
          <View key={p.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.name}>{p.label}</Text>
              <View style={styles.badges}>
                {isManaged && (
                  <View style={[styles.badge, styles.badgeManaged]}>
                    <Text style={styles.badgeText}>Managed</Text>
                  </View>
                )}
                {isByok && (
                  <View style={[styles.badge, styles.badgeByok]}>
                    <Text style={styles.badgeText}>Your key</Text>
                  </View>
                )}
                {!isManaged && !isByok && <Text style={styles.notSet}>Not set up</Text>}
              </View>
            </View>
            <Text style={styles.meta}>
              {count > 0
                ? `${count} generation${count === 1 ? "" : "s"} on this device`
                : "No generations on this device"}
            </Text>
          </View>
        );
      })}
      <Text style={styles.note}>
        Managed access is your plan (server-tracked). “Your key” and its usage are stored on
        this device only — check your provider’s console for real billing.
      </Text>
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
  row: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border },
  rowHead: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  name: { color: c.text, fontSize: 15, fontWeight: "600" as const, flexShrink: 1 },
  badges: { flexDirection: "row" as const, gap: 6, alignItems: "center" as const },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeManaged: { backgroundColor: c.brand + "22" },
  badgeByok: { backgroundColor: c.textMuted + "22" },
  badgeText: { color: c.text, fontSize: 11, fontWeight: "600" as const },
  notSet: { color: c.textMuted, fontSize: 12 },
  meta: { color: c.textMuted, fontSize: 12 },
  note: { color: c.textMuted, fontSize: 12, lineHeight: 18, marginTop: 2 },
});
