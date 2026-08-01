import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

const AVATAR = 56;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// A small profile badge for the top-right of the Library: the signed-in user's
// Google photo with their full name underneath (both come from the Supabase
// session's user_metadata, populated from Google on OAuth). Self-positioning
// (absolute, top-right) and self-gating: hidden when auth is unavailable
// (demo/unconfigured), a "Sign in" affordance when signed out, the profile when
// signed in. Tapping opens Account (or sign-in).
export function UserChip() {
  const router = useRouter();
  const { status, session } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (status === "unavailable") return null;

  if (status !== "signed_in") {
    return (
      <Pressable
        style={styles.wrap}
        onPress={() => router.push("/sign-in")}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
      >
        <View style={styles.placeholder}>
          <Ionicons name="person-circle-outline" size={52} color={theme.textSecondary} />
        </View>
        <Text style={styles.name} numberOfLines={1}>
          Sign in
        </Text>
      </Pressable>
    );
  }

  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const photo =
    typeof meta.avatar_url === "string"
      ? meta.avatar_url
      : typeof meta.picture === "string"
        ? meta.picture
        : null;
  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    session?.user?.email ||
    "";

  return (
    <Pressable
      style={styles.wrap}
      onPress={() => router.push("/account")}
      accessibilityRole="button"
      accessibilityLabel={`Account${fullName ? `: ${fullName}` : ""}`}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>{initials(fullName)}</Text>
        </View>
      )}
      {fullName ? (
        <Text style={styles.name} numberOfLines={1}>
          {fullName}
        </Text>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: {
    position: "absolute" as const,
    top: spacing.sm,
    right: spacing.md,
    alignItems: "center" as const,
    maxWidth: 110,
    zIndex: 10,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
  },
  fallback: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: c.surfaceHigh,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: c.border,
  },
  fallbackText: { color: c.text, fontWeight: "700" as const, fontSize: typography.sizeSm },
  placeholder: { width: AVATAR, height: AVATAR, alignItems: "center" as const, justifyContent: "center" as const },
  name: {
    marginTop: 2,
    fontSize: typography.sizeXs,
    color: c.textSecondary,
    maxWidth: 110,
    textAlign: "center" as const,
  },
});
