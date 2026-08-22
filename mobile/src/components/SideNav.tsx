import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";
import { NAV_TABS, NAV_ORDER, MARKETING_LINKS } from "./navItems";
import { navModel, goToAnchor } from "./navState";
import { UserChip } from "./UserChip";
import { ChromeUsageMeter } from "./ChromeUsageMeter";

// A persistent left sidebar version of TopNavBar for wide screens (isDesktop):
// the same destinations + navigation, laid out as a full-height 256px column so
// every tab is visible at once. Passed to <Tabs tabBar={…}> with
// tabBarPosition:"left", which shifts the scene to the right.
// Auth-state-aware (navModel, shared with TopNavBar): signed out shows
// marketing links + Sign in, signed in shows the app tabs + AccountMenu,
// loading shows only Home (no flash of the wrong set while auth resolves).
export function SideNav({ state, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { status } = useAuth();
  const nav = navModel(status);
  const routeByName = new Map(state.routes.map((r) => [r.name, r] as const));
  const activeName = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = routeByName.get(name);
    if (!route) return;
    const focused = name === activeName;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  // Shared row renderer so the "app" (full NAV_ORDER) and "loading" (Home-only)
  // branches don't duplicate the Pressable/Ionicons/Text markup.
  const renderRow = (name: string) => {
    const cfg = NAV_TABS[name];
    if (!cfg || !routeByName.has(name)) return null;
    const focused = name === activeName;
    return (
      <Pressable
        key={name}
        onPress={() => go(name)}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={cfg.label}
        style={[styles.row, focused && styles.rowActive]}
      >
        <Ionicons name={focused ? cfg.active : cfg.inactive} size={22} color={focused ? theme.primaryText : theme.text} />
        <Text style={[styles.rowLabel, focused && styles.rowLabelActive]} numberOfLines={1}>{cfg.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <Pressable
        onPress={() => go("index")}
        accessibilityRole="button"
        accessibilityLabel="Mentible — go to Home"
        style={styles.brandRow}
      >
        <Image source={require("../../assets/brand/mentible-icon-1024-redorange.png")} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandText}>Mentible</Text>
      </Pressable>

      {nav.showAccount && (
        <View style={styles.accountBlock}>
          <UserChip />
          <ChromeUsageMeter style={styles.meterRight} />
        </View>
      )}

      {nav.mode === "app" && NAV_ORDER.map(renderRow)}

      {/* loading: brand row (above) + Home only — no flash of the full
          app-tab set, no marketing links, no Sign-in, while auth resolves. */}
      {nav.mode === "loading" && renderRow("index")}

      {nav.mode === "marketing" &&
        MARKETING_LINKS.map((link) => (
          <Pressable
            key={link.anchor}
            onPress={() => goToAnchor(link.anchor, router)}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            style={styles.row}
          >
            <Text style={styles.rowLabel} numberOfLines={1}>{link.label}</Text>
          </Pressable>
        ))}

      {nav.showSignIn && (
        <Pressable
          onPress={() => router.push("/sign-in")}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          style={styles.signInBtn}
        >
          <Text style={styles.signInText}>Sign in</Text>
        </Pressable>
      )}

      <View style={styles.spacer} />
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: { width: 256, height: "100%" as const, backgroundColor: c.background, borderRightColor: c.border, borderRightWidth: 1, paddingHorizontal: spacing.sm, gap: spacing.xs },
  brandRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  logo: { width: 40, height: 40 },
  brandText: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
  rowActive: { backgroundColor: c.primary },
  rowLabel: { color: c.text, fontSize: typography.sizeMd, fontWeight: "500" as const },
  rowLabelActive: { color: c.primaryText },
  signInBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.xs,
  },
  signInText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "600" as const },
  // Pushes the account menu / sign-in area to the trailing (bottom) edge of
  // the column when there's room, mirroring TopNavBar's trailing-edge layout.
  spacer: { flex: 1 },
  accountBlock: { alignItems: "flex-start" as const, gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  meterRight: { alignSelf: "flex-start" as const },
});
