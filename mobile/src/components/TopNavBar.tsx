import React from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { NAV_TABS, NAV_ORDER } from "./navItems";

// Top, center-aligned navigation bar with square icon+label tiles and a leading
// Mentible mark that jumps to Library (home). Replaces the default bottom tab bar
// (passed to <Tabs tabBar={…}>); horizontally scrollable so items don't cramp a phone.
export function TopNavBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const routeByName = new Map(state.routes.map((r) => [r.name, r] as const));
  const activeName = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = routeByName.get(name);
    if (!route) return;
    const focused = name === activeName;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Pressable
          onPress={() => go("library")}
          accessibilityRole="button"
          accessibilityLabel="Mentible — go to Library (home)"
          // Press feedback so a tap always registers, even when already on Library.
          style={({ pressed }) => [styles.logoBtn, pressed && styles.logoBtnPressed]}
        >
          <Image
            source={require("../../assets/brand/mentible-icon-1024-redorange.png")}
            style={styles.logo}
            resizeMode="contain"
          />
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
              style={[styles.tile, focused && styles.tileActive]}
            >
              <Ionicons
                name={focused ? cfg.active : cfg.inactive}
                size={22}
                color={focused ? theme.tileOnGlyph : theme.tileOffGlyph}
              />
              <Text
                style={[styles.tileLabel, focused && styles.tileLabelActive]}
                numberOfLines={1}
              >
                {cfg.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: {
    // Darkest token so the lighter tiles read as raised buttons against it.
    backgroundColor: c.background,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
  },
  // flexGrow + center → centered when the row fits, scrollable when it overflows.
  row: {
    flexGrow: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  logoBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: c.tileOffFace,
    borderWidth: 2,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginRight: spacing.xs,
  },
  logoBtnPressed: { opacity: 0.6, transform: [{ scale: 0.96 }] },
  // Fill the tile's full inner box (64 − 2×2 border = 60). resizeMode="contain"
  // keeps the mark undistorted; its own transparent padding leaves visual margin.
  logo: { width: 60, height: 60 },
  // Square tiles (icon over label) with a beveled edge. Default = raised: a
  // white face with a light top/left highlight and a grey bottom/right shadow,
  // so it stands off the dark bar; glyphs are black. Selected (tileActive)
  // flips the bevel — dark top/left, light bottom/right — over a yellow face
  // with black glyphs, so the active tile looks pressed in.
  tile: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: c.tileOffFace,
    borderWidth: 2,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    gap: 3,
  },
  tileActive: {
    backgroundColor: c.tileOnFace,
    borderTopColor: c.tileOnLo,
    borderLeftColor: c.tileOnLo,
    borderBottomColor: c.tileOnHi,
    borderRightColor: c.tileOnHi,
  },
  tileLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.tileOffGlyph,
  },
  tileLabelActive: { color: c.tileOnGlyph },
});
