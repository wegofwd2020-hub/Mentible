import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (status === "signed_in" || status === "unavailable") return <>{children}</>;

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Ionicons name="lock-closed-outline" size={28} color={theme.primary} />
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

const makeStyles = (c: Palette) => ({
  center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  card: {
    alignItems: "center" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    margin: spacing.lg,
  },
  title: { fontSize: typography.sizeLg, fontWeight: "800" as const, color: c.text, textAlign: "center" as const },
  body: {
    fontSize: typography.sizeSm,
    color: c.textSecondary,
    textAlign: "center" as const,
    lineHeight: 21,
  },
  btn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
  },
  btnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeMd },
});
