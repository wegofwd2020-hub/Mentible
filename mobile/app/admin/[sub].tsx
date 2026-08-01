import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Alert } from "@/lib/alert";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import {
  deleteUser,
  getUser,
  reactivateUser,
  suspendUser,
  type AdminUserDetail,
} from "@/api/adminClient";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Super-admin detail for one user (ADR-020): credentials, devices, and the
// suspend / reactivate / delete actions (all audited server-side).
export default function AdminUserScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { sub } = useLocalSearchParams<{ sub: string }>();
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !sub) return;
    setLoading(true);
    setError(null);
    try {
      setUser(await getUser(accessToken, sub));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load this user.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, sub]);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load]),
  );

  const onToggleSuspend = useCallback(async () => {
    if (!accessToken || !user) return;
    setBusy(true);
    try {
      const updated = user.suspended
        ? await reactivateUser(accessToken, user.sub)
        : await suspendUser(accessToken, user.sub);
      setUser({ ...user, suspended: updated.suspended, suspended_at: updated.suspended_at });
    } catch (e) {
      Alert.alert("Action failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }, [accessToken, user]);

  const onDelete = useCallback(() => {
    if (!accessToken || !user) return;
    Alert.alert(
      "Delete user?",
      "Permanently deletes this account and its provider + device records. The audit trail is kept. When server-side identity deletion is enabled, the user's Supabase sign-in identity is removed too, so they can re-register fresh.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await deleteUser(accessToken, user.sub);
              router.back();
            } catch (e) {
              Alert.alert("Couldn’t delete", e instanceof Error ? e.message : "Try again.");
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [accessToken, user, router]);

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  if (account && !isAdmin) return <Redirect href="/settings" />;

  if (loading && !user) {
    return (
      <PageContainer>
        <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />
      </PageContainer>
    );
  }
  if (error || !user) {
    return (
      <PageContainer>
        <Text style={styles.error}>{error ?? "User not found."}</Text>
      </PageContainer>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <Text style={styles.email}>{user.email ?? "(no email)"}</Text>
        <Text style={styles.sub}>{user.sub}</Text>
        {user.suspended ? <Text style={styles.suspendedBadge}>SUSPENDED</Text> : null}

        <Text style={styles.section}>Devices ({user.device_count})</Text>
        {user.devices.length === 0 ? (
          <Text style={styles.muted}>No devices recorded.</Text>
        ) : (
          user.devices.map((d) => (
            <View key={d.device_id} style={styles.card}>
              <Text style={styles.cardTitle}>
                {d.label ?? d.platform ?? "Device"}
                {d.platform ? <Text style={styles.muted}> · {d.platform}</Text> : null}
              </Text>
              <Text style={styles.muted}>last seen {formatDateTime(d.last_seen)}</Text>
            </View>
          ))
        )}

        <Text style={styles.section}>Providers</Text>
        {user.credentials.length === 0 ? (
          <Text style={styles.muted}>No provider credentials.</Text>
        ) : (
          user.credentials.map((c) => (
            <View key={c.provider_id} style={styles.card}>
              <Text style={styles.cardTitle}>{c.provider_id}</Text>
              <Text style={styles.muted}>
                {c.source} · {c.status}
              </Text>
            </View>
          ))
        )}

        <Pressable
          style={[styles.action, busy && styles.actionDisabled]}
          disabled={busy}
          onPress={onToggleSuspend}
        >
          <Text style={styles.actionText}>{user.suspended ? "Reactivate" : "Suspend"}</Text>
        </Pressable>

        <Pressable style={styles.deleteBtn} disabled={busy} onPress={onDelete}>
          <Text style={styles.deleteText}>Delete user</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  // ScrollView owns a bounded height (flex:1) so it scrolls; PageContainer inside.
  scroll: { flex: 1 as const, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 as const, paddingBottom: spacing.xl },
  email: { color: c.text, fontSize: typography.sizeXl, fontWeight: "700" as const },
  sub: { color: c.textMuted, fontSize: typography.sizeXs, fontFamily: "monospace" as const, marginTop: 2 },
  suspendedBadge: {
    color: c.warning,
    fontSize: typography.sizeXs,
    fontWeight: "800" as const,
    marginTop: spacing.sm,
  },
  section: {
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  muted: { color: c.textMuted, fontSize: typography.sizeSm },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  action: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.lg,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  deleteBtn: { paddingVertical: spacing.md, alignItems: "center" as const, marginTop: spacing.md },
  deleteText: { color: c.error, fontSize: typography.sizeMd, fontWeight: "700" as const },
  error: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.lg },
});
