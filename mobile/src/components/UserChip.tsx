import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

const AVATAR = 44;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// The signed-in profile avatar, placed by the nav chrome (TopNavBar top-right /
// SideNav top) with the plan/usage pill rendered directly beneath it by the host.
// The Google photo (or initials fallback) comes from the Supabase session's
// user_metadata. Renders null unless signed in — the nav's own "Sign in" button
// covers the signed-out case. Tapping opens the Account screen.
export function UserChip(): React.JSX.Element | null {
  const router = useRouter();
  const { status, session } = useAuth();
  const styles = useThemedStyles(makeStyles);

  if (status !== "signed_in") return null;

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
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
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
});
