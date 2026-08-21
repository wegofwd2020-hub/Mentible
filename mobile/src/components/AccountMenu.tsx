import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useThemedStyles } from "@/theme";
import { radius, spacing, typography, type Palette } from "@/constants/theme";

// Signed-in avatar popover for the top nav (unified-nav work). Lists the
// account-scoped destinations (Settings/Help/About) plus Sign out. Kept
// dependency-free (no external menu/portal lib) — a simple toggled <View>
// anchored under the avatar button, matching SideNav's plain-RN-primitives
// style.
const ITEMS: { label: string; href?: string; signOut?: boolean }[] = [
  { label: "Settings", href: "/settings" },
  { label: "Help", href: "/help" },
  { label: "About", href: "/about" },
  { label: "Sign out", signOut: true },
];

export function AccountMenu(): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        style={styles.avatar}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={styles.avatarText}>⌄</Text>
      </Pressable>
      {open && (
        <View style={styles.menu}>
          {ITEMS.map((it) => (
            <Pressable
              key={it.label}
              accessibilityRole="button"
              style={styles.item}
              onPress={() => {
                setOpen(false);
                if (it.signOut) {
                  void signOut();
                } else if (it.href) {
                  router.push(it.href as Href);
                }
              }}
            >
              <Text style={styles.itemText}>{it.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  container: { position: "relative" as const },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: c.surfaceHigh,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  avatarText: { color: c.text, fontSize: typography.sizeMd },
  menu: {
    position: "absolute" as const,
    top: 44,
    right: 0,
    minWidth: 160,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    zIndex: 20,
    elevation: 4,
  },
  item: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  itemText: { color: c.text, fontSize: typography.sizeMd },
});
