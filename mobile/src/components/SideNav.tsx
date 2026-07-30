import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { NAV_TABS, NAV_ORDER } from "./navItems";

// A persistent left sidebar version of TopNavBar for wide screens (isDesktop):
// the same destinations + navigation, laid out as a full-height 256px column so
// every tab is visible at once. Passed to <Tabs tabBar={…}> with
// tabBarPosition:"left", which shifts the scene to the right.
export function SideNav({ state, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const routeByName = new Map(state.routes.map((r) => [r.name, r] as const));
  const activeName = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = routeByName.get(name);
    if (!route) return;
    const focused = name === activeName;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
      <Pressable
        onPress={() => go("library")}
        accessibilityRole="button"
        accessibilityLabel="Mentible — go to Library (home)"
        style={styles.brandRow}
      >
        <Image source={require("../../assets/brand/mentible-icon-1024-redorange.png")} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandText}>Mentible</Text>
      </Pressable>
      {NAV_ORDER.map((name) => {
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
            <Ionicons name={focused ? cfg.active : cfg.inactive} size={22} color={focused ? colors.primaryText : colors.text} />
            <Text style={[styles.rowLabel, focused && styles.rowLabelActive]} numberOfLines={1}>{cfg.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: 256, height: "100%", backgroundColor: colors.background, borderRightColor: colors.border, borderRightWidth: 1, paddingHorizontal: spacing.sm, gap: spacing.xs },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  logo: { width: 40, height: 40 },
  brandText: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
  rowActive: { backgroundColor: colors.primary },
  rowLabel: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  rowLabelActive: { color: colors.primaryText },
});
