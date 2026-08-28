import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { getUsageByUser, type AdminUsageByUser, type AdminUsageRow } from "@/api/adminClient";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

const WINDOWS: { label: string; days: number }[] = [
  { label: "30 days", days: 30 },
  { label: "1 year", days: 366 },
];

const nfmt = (n: number) => n.toLocaleString();
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

// Super-admin token-usage dashboard (per user, managed path only — BYOK records
// nothing, ADR-001). Operator-only; the backend also 403s a non-operator.
export default function AdminUsageScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminUsageByUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getUsageByUser(accessToken, days));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load usage.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, days]);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  if (account && !isAdmin) return <Redirect href="/settings" />;

  const grandTotal = data ? data.total_input_tokens + data.total_output_tokens : 0;

  const renderRow = ({ item }: { item: AdminUsageRow }) => (
    <View style={styles.row} accessibilityLabel={`Usage for ${item.email ?? item.sub ?? "unknown"}`}>
      <View style={styles.rowHead}>
        <Text style={styles.email} numberOfLines={1}>
          {item.email ?? item.sub ?? "(deleted account)"}
        </Text>
        <Text style={styles.total}>{nfmt(item.total_tokens)} tok</Text>
      </View>
      <Text style={styles.meta}>
        in {nfmt(item.input_tokens)} · out {nfmt(item.output_tokens)} · {usd(item.cost_micros)} ·{" "}
        {item.events} {item.events === 1 ? "gen" : "gens"} · {item.providers.join(", ") || "—"} ·
        last {shortDate(item.last_used)}
      </Text>
    </View>
  );

  return (
    <PageContainer>
      <Text style={styles.title}>Token usage</Text>
      <Text style={styles.sub}>Managed generations only — BYOK usage isn’t metered.</Text>

      <View style={styles.windowRow}>
        {WINDOWS.map((w) => (
          <Pressable
            key={w.days}
            onPress={() => setDays(w.days)}
            style={[styles.pill, days === w.days ? styles.pillOn : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: days === w.days }}
            accessibilityLabel={`Window: ${w.label}`}
          >
            <Text style={[styles.pillText, days === w.days ? styles.pillTextOn : null]}>{w.label}</Text>
          </Pressable>
        ))}
      </View>

      {data ? (
        <Text style={styles.grand}>
          {nfmt(grandTotal)} tokens · {usd(data.total_cost_micros)} across {data.rows.length}{" "}
          {data.rows.length === 1 ? "user" : "users"}
        </Text>
      ) : null}

      {loading && !data ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={data?.rows ?? []}
          keyExtractor={(r, i) => r.sub ?? `deleted-${i}`}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          onRefresh={load}
          refreshing={loading}
          renderItem={renderRow}
          ListEmptyComponent={<Text style={styles.meta}>No managed usage in this window yet.</Text>}
        />
      )}
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  sub: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.md },
  windowRow: { flexDirection: "row" as const, gap: spacing.sm, marginBottom: spacing.sm },
  pill: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillOn: { backgroundColor: c.primary, borderColor: c.primary },
  pillText: { color: c.textSecondary, fontSize: typography.sizeSm },
  pillTextOn: { color: c.primaryText, fontWeight: "700" as const },
  grand: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const, marginBottom: spacing.md },
  row: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowHead: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  email: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const, flex: 1 },
  total: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  meta: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 4 },
  error: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.md },
});
