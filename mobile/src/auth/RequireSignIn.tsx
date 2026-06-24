import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Gate any "activity" (authoring, generating, key entry) behind a signed-in
// account. Reading the library stays open — only wrap the screens/sections that
// do something. Renders its children when allowed, otherwise a friendly
// "sign in to <action>" interstitial.
//
// By auth status:
//   signed_in   → children (allowed)
//   loading     → a brief spinner (avoid flashing content before auth resolves)
//   signed_out  → the interstitial with a Sign-in button
//   unavailable → children (demo / unconfigured builds can't sign in; those are
//                 gated elsewhere by IS_DEMO, and we must not trap the user)
export function RequireSignIn({
  action,
  children,
}: {
  action: string;
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();

  if (status === "signed_in" || status === "unavailable") return <>{children}</>;

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Ionicons name="lock-closed-outline" size={28} color={colors.primary} />
      <Text style={styles.title}>Sign in to {action}</Text>
      <Text style={styles.body}>
        Create a free account or sign in to {action}. You can keep reading the library without an
        account.
      </Text>
      <Pressable
        style={styles.btn}
        onPress={() => router.push("/sign-in")}
        accessibilityRole="button"
        accessibilityLabel={`Sign in to ${action}`}
      >
        <Text style={styles.btnText}>Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    margin: spacing.lg,
  },
  title: { fontSize: typography.sizeLg, fontWeight: "800", color: colors.text, textAlign: "center" },
  body: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
  },
  btnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
