import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Alert } from "@/lib/alert";
import { useFocusEffect } from "expo-router";
import { getManagedStatus, type ManagedStatus } from "@/api/billingClient";
import { useAuth } from "@/auth/AuthProvider";
import { ManagedPlanCard } from "@/components/ManagedPlanCard";
import { PageContainer } from "@/components/PageContainer";
import { clearUsage, listUsage, summarizeUsage, type UsageSummary } from "@/storage/usageStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

const fmt = (n: number) => n.toLocaleString();

function fmtCost(n: number | null): string {
  if (n === null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export default function UsageScreen() {
  const { accessToken } = useAuth();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [managed, setManaged] = useState<ManagedStatus | null>(null);

  const load = useCallback(async () => {
    setSummary(summarizeUsage(await listUsage()));
    // Managed status is server-sourced and only for signed-in users; failures fall
    // back to hiding the card (the device-local BYOK ledger always shows).
    if (accessToken) {
      try {
        setManaged(await getManagedStatus(accessToken));
      } catch {
        setManaged(null);
      }
    } else {
      setManaged(null);
    }
  }, [accessToken]);

  // Refresh whenever the screen is focused so newly generated topics show up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onClear = () => {
    Alert.alert(
      "Clear usage history?",
      "This removes the locally recorded token-usage history on this device. It does not affect anything at your provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearUsage();
            await load();
          },
        },
      ],
    );
  };

  const empty = !summary || summary.totalGenerations === 0;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        {/* Server-sourced managed-plan meter (signed-in users). The device-local BYOK
            ledger below is unaffected. */}
        {managed && <ManagedPlanCard status={managed} />}

        {/* BYOK honesty banner — observed, not billed. */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            These are the tokens we observed sending on your behalf — not your provider’s
            bill. Costs are estimates from public list rates and can’t see discounts,
            free-tier credits, or your actual invoice. Check your provider console for the
            real charge.
          </Text>
        </View>

        {empty ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No generations recorded on this device yet.</Text>
            <Text style={styles.emptySub}>
              Token usage is captured automatically the next time you generate a topic.
            </Text>
          </View>
        ) : (
          <>
            {/* Totals */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>This device</Text>
              <View style={styles.totalRow}>
                <Stat label="Generations" value={fmt(summary.totalGenerations)} />
                <Stat label="Est. cost" value={fmtCost(summary.estCostUsd)} />
              </View>
              <View style={styles.totalRow}>
                <Stat label="Input tokens" value={fmt(summary.totalInputTokens)} />
                <Stat label="Output tokens" value={fmt(summary.totalOutputTokens)} />
              </View>
              {summary.anyRateUnknown && (
                <Text style={styles.note}>
                  Cost omits models with no known rate (shown as “—” below).
                </Text>
              )}
              {summary.anyTokensEstimated && (
                <Text style={styles.note}>
                  Some rows are approximate — a provider didn’t report exact counts.
                </Text>
              )}
            </View>

            {/* By provider × model */}
            <Text style={styles.sectionTitle}>By model</Text>
            {summary.byModel.map((m) => (
              <View key={`${m.provider} ${m.model}`} style={styles.modelRow}>
                <View style={styles.modelHead}>
                  <Text style={styles.modelName}>{m.model}</Text>
                  <Text style={styles.modelProvider}>{m.provider}</Text>
                </View>
                <View style={styles.modelStats}>
                  <Text style={styles.modelStat}>{m.generations} gen</Text>
                  <Text style={styles.modelStat}>
                    {fmt(m.inputTokens)} in · {fmt(m.outputTokens)} out
                  </Text>
                  <Text style={styles.modelCost}>
                    {fmtCost(m.estCostUsd)}
                    {m.anyEstimated ? " ≈" : ""}
                  </Text>
                </View>
              </View>
            ))}

            <Pressable style={styles.clearBtn} onPress={onClear}>
              <Text style={styles.clearText}>Clear usage history</Text>
            </Pressable>
          </>
        )}
      </PageContainer>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ScrollView owns a bounded height (flex:1) so it scrolls; PageContainer goes
  // inside and supplies the padding+gap the old `content` style did.
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  disclaimer: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  disclaimerText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  emptyBox: { padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  emptyText: { color: colors.text, fontSize: 15, textAlign: "center" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  totalRow: { flexDirection: "row", gap: spacing.md },
  stat: { flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "700" },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: colors.textMuted, fontSize: 12, fontStyle: "italic" },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: typography.fontHeading,
    marginTop: spacing.sm,
  },
  modelRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  modelName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  modelProvider: { color: colors.textMuted, fontSize: 12 },
  modelStats: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modelStat: { color: colors.textMuted, fontSize: 13 },
  modelCost: { color: colors.text, fontSize: 14, fontWeight: "600" },
  clearBtn: { padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  clearText: { color: colors.brand, fontSize: 14 },
});
