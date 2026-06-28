import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Alert } from "@/lib/alert";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Stack, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import { PageContainer } from "@/components/PageContainer";
import { HelpHint } from "@/components/HelpHint";
import { PROVIDERS } from "@/constants/providers";
import { deleteApiKey } from "@/secure/keyStore";
import { clearDeviceData } from "@/device/clearDeviceData";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function AccountScreen() {
  const router = useRouter();
  const { status, session, resetPassword, signOut } = useAuth();
  const { account, error, setCredential, removeCredential, purge } = useAccount();
  const [busy, setBusy] = useState(false);

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;

  const email = account?.email ?? session?.user?.email ?? "";
  const credBy = new Map((account?.credentials ?? []).map((c) => [c.provider_id, c]));

  const onReset = async () => {
    const { error: err } = await resetPassword(email);
    Alert.alert(
      err ? "Couldn’t send reset email" : "Check your email",
      err ?? `We sent a password-reset link to ${email}.`,
    );
  };

  const onDelete = () => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and signs you out, then wipes this device — API keys, local library and books, and onboarding — so it starts fresh. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              // Purge the synced account (and, when the server has identity
              // deletion enabled, the Supabase sign-in identity too — ADR-022),
              // then wipe local state so the next sign-in is a clean first run.
              await purge();
              await clearDeviceData();
              await signOut();
              router.replace("/settings");
            } catch (e) {
              Alert.alert("Couldn’t delete account", e instanceof Error ? e.message : "Try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const onClearDevice = () => {
    Alert.alert(
      "Sign out & clear this device?",
      "Removes everything stored on this device — your API keys, local library and books, and onboarding — then signs you out. Your synced account stays; signing back in starts fresh on this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear & sign out",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await clearDeviceData();
              await signOut();
              router.replace("/settings");
            } catch (e) {
              Alert.alert("Couldn’t clear device", e instanceof Error ? e.message : "Try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const onClearLocalKeys = () => {
    Alert.alert("Remove saved API keys?", "Removes every provider API key (BYOK) stored on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await Promise.all(PROVIDERS.map((p) => deleteApiKey(p.id)));
          Alert.alert("Cleared", "All device-local provider keys were removed.");
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          // Robust back: return to the previous screen, or to the Library when
          // this screen was opened directly (e.g. a fresh OAuth page-load) with no
          // history — so Account is never a dead-end.
          headerLeft: () => (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/library"))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.headerBack}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <PageContainer>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email}>{email || "—"}</Text>

        <Pressable style={styles.linkRow} onPress={onReset}>
          <Text style={styles.linkText}>Send password-reset email</Text>
        </Pressable>

        {account?.is_super_admin ? (
          <Pressable
            style={styles.adminRow}
            onPress={() => router.push("/admin")}
            accessibilityRole="button"
            accessibilityLabel="Open the admin console"
          >
            <Text style={styles.adminText}>🛡 Admin · manage users</Text>
            <Text style={styles.adminChevron}>›</Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionRow}>
          <Text style={[styles.section, styles.sectionInRow]}>Providers</Text>
          <HelpHint
            label="Providers"
            text="Marks which providers you hold a key for. Only this on/off marker is saved to your account — the key value itself never leaves this device. 'On this device' marks it here; 'Remove' clears that."
          />
        </View>
        <Text style={styles.hint}>
          Which providers you have a key for. Keys themselves stay on your device (BYOK).
        </Text>
        {PROVIDERS.map((p) => {
          const cred = credBy.get(p.id);
          return (
            <View key={p.id} style={styles.providerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.providerLabel}>{p.label}</Text>
                <Text style={styles.providerStatus}>
                  {cred ? `${cred.source} · ${cred.status}` : "not on this account"}
                </Text>
              </View>
              {cred ? (
                <Pressable onPress={() => void removeCredential(p.id)}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => void setCredential(p.id, "device_local")}>
                  <Text style={styles.addText}>On this device</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={styles.secondaryButton}
          onPress={async () => {
            await signOut();
            router.replace("/settings");
          }}
        >
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>

        <View style={styles.actionRow}>
          <Pressable style={[styles.secondaryButton, styles.actionBtn]} onPress={onClearLocalKeys}>
            <Text style={styles.secondaryText}>Remove saved API keys</Text>
          </Pressable>
          <HelpHint
            label="Remove saved API keys"
            text="Removes your saved provider API keys (BYOK) from this device. Your library, books, and sign-in are untouched."
          />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.secondaryButton, styles.actionBtn]}
            disabled={busy}
            onPress={onClearDevice}
          >
            <Text style={styles.secondaryText}>Sign out & clear this device</Text>
          </Pressable>
          <HelpHint
            label="Sign out & clear this device"
            text="Wipes everything on this device — API keys, local library, books, onboarding — and signs you out. Your account isn't deleted."
          />
        </View>

        <View style={[styles.actionRow, { marginTop: spacing.xl }]}>
          <Pressable
            style={[styles.deleteButton, styles.actionBtn]}
            disabled={busy}
            onPress={onDelete}
          >
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
          <HelpHint
            label="Delete account"
            text="Permanently deletes your account and signs you out. This can't be undone."
          />
        </View>
        </PageContainer>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  headerBack: { paddingHorizontal: spacing.sm },
  // ScrollView must own a bounded height (flex:1) to actually scroll; otherwise it
  // grows to its content and the page overflows the viewport with no scrollbar
  // (PageContainer goes *inside* the ScrollView — see its doc + settings.tsx).
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, paddingBottom: spacing.xl },
  // A destructive action + its HelpHint on one row (the button's own marginTop
  // moves to the row via actionBtn).
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, marginTop: 0 },
  label: { color: colors.textMuted, fontSize: typography.sizeXs, textTransform: "uppercase" },
  email: { color: colors.text, fontSize: typography.sizeXl, fontWeight: "700", marginBottom: spacing.md },
  linkRow: { paddingVertical: spacing.sm },
  linkText: { color: colors.primary, fontSize: typography.sizeMd },
  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  adminText: { flex: 1, color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  adminChevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  section: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "700", marginTop: spacing.lg },
  // Section heading + its `?` HelpHint on one row (marginTop moves to the row).
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sectionInRow: { marginTop: 0 },
  hint: { color: colors.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  providerLabel: { color: colors.text, fontSize: typography.sizeMd },
  providerStatus: { color: colors.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  addText: { color: colors.primary, fontSize: typography.sizeSm },
  removeText: { color: colors.error, fontSize: typography.sizeSm },
  error: { color: colors.error, fontSize: typography.sizeSm, marginTop: spacing.sm },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  secondaryText: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  deleteButton: { paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl },
  deleteText: { color: colors.error, fontSize: typography.sizeMd, fontWeight: "700" },
});
