import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { listUsers, type AdminUserRow } from "@/api/adminClient";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Super-admin user list (ADR-020). Operator-only — gated on the account's
// is_super_admin flag (the backend re-checks and 403s regardless). Read-only
// here; per-user actions live on the detail screen.
export default function AdminScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listUsers(accessToken, { limit: 200 });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load users.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // Reload when focused (e.g. returning from a suspend/delete on the detail screen).
  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  // Wait for the account (carries is_super_admin); then bounce non-operators.
  if (account && !isAdmin) return <Redirect href="/settings" />;

  return (
    <PageContainer>
      <Text style={styles.title}>Users</Text>
      <Text style={styles.sub}>
        {total} registered {total === 1 ? "account" : "accounts"}
      </Text>

      <Pressable
        style={styles.linkRow}
        onPress={() => router.push("/admin/usage")}
        accessibilityRole="button"
        accessibilityLabel="View token usage by user"
      >
        <Text style={styles.linkText}>Token usage by user</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      {loading && users.length === 0 ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.sub}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          onRefresh={load}
          refreshing={loading}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/admin/${encodeURIComponent(item.sub)}`)}
              accessibilityRole="button"
              accessibilityLabel={`Manage ${item.email ?? item.sub}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.email} numberOfLines={1}>
                  {item.email ?? "(no email)"}
                </Text>
                <Text style={styles.meta}>
                  joined {formatDate(item.created_at)} · {item.device_count}{" "}
                  {item.device_count === 1 ? "device" : "devices"}
                </Text>
              </View>
              {item.suspended ? <Text style={styles.suspended}>suspended</Text> : null}
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.meta}>No users yet.</Text>}
        />
      )}
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  sub: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.md },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  email: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  meta: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  suspended: {
    color: c.warning,
    fontSize: typography.sizeXs,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
  },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  error: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.md },
  linkRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  linkText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
});
