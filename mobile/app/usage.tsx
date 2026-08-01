import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Alert } from "@/lib/alert";
import { useFocusEffect } from "expo-router";
import { getManagedStatus, type ManagedStatus } from "@/api/billingClient";
import { useAuth } from "@/auth/AuthProvider";
import { ManagedPlanCard } from "@/components/ManagedPlanCard";
import { PageContainer } from "@/components/PageContainer";
import { clearUsage, listUsage, summarizeUsage, type UsageSummary } from "@/storage/usageStore";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

const fmt = (n: number) => n.toLocaleString();

function fmtCost(n: number | null): string {
  if (n === null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export default function UsageScreen() {
  const styles = useThemedStyles(makeStyles);
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
                <Stat label="Generations" value={fmt(summary.totalGenerations)} styles={styles} />
                <Stat label="Est. cost" value={fmtCost(summary.estCostUsd)} styles={styles} />
              </View>
              <View style={styles.totalRow}>
                <Stat label="Input tokens" value={fmt(summary.totalInputTokens)} styles={styles} />
                <Stat label="Output tokens" value={fmt(summary.totalOutputTokens)} styles={styles} />
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

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  // ScrollView owns a bounded height (flex:1) so it scrolls; PageContainer goes
  // inside and supplies the padding+gap the old `content` style did.
  scroll: { flex: 1 as const, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 as const },
  disclaimer: {
    backgroundColor: c.surface,
    borderLeftWidth: 3,
    borderLeftColor: c.warning,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  disclaimerText: { color: c.textMuted, fontSize: 13, lineHeight: 19 },
  emptyBox: { padding: spacing.lg, alignItems: "center" as const, gap: spacing.sm },
  emptyText: { color: c.text, fontSize: 15, textAlign: "center" as const },
  emptySub: { color: c.textMuted, fontSize: 13, textAlign: "center" as const },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLabel: {
    color: c.textMuted,
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  totalRow: { flexDirection: "row" as const, gap: spacing.md },
  stat: { flex: 1 as const },
  statValue: { color: c.text, fontSize: 22, fontWeight: "700" as const },
  statLabel: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: c.textMuted, fontSize: 12, fontStyle: "italic" as const },
  sectionTitle: {
    color: c.text,
    fontSize: 16,
    fontFamily: typography.fontHeading,
    marginTop: spacing.sm,
  },
  modelRow: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modelHead: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "baseline" as const },
  modelName: { color: c.text, fontSize: 15, fontWeight: "600" as const },
  modelProvider: { color: c.textMuted, fontSize: 12 },
  modelStats: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  modelStat: { color: c.textMuted, fontSize: 13 },
  modelCost: { color: c.text, fontSize: 14, fontWeight: "600" as const },
  clearBtn: { padding: spacing.md, alignItems: "center" as const, marginTop: spacing.sm },
  clearText: { color: c.brand, fontSize: 14 },
});
