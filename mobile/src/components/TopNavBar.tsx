import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors, radius, spacing, typography } from "@/constants/theme";

type IconName = keyof typeof Ionicons.glyphMap;

// route name → label + active/inactive icon. The app launches on Library;
// `index` is a redirect-to-Library route (not shown).
const TABS: Record<string, { label: string; active: IconName; inactive: IconName }> = {
  library: { label: "Library", active: "bookmarks", inactive: "bookmarks-outline" },
  books: { label: "Books", active: "book", inactive: "book-outline" },
  settings: { label: "Settings", active: "settings", inactive: "settings-outline" },
  help: { label: "Help", active: "help-circle", inactive: "help-circle-outline" },
  about: { label: "About", active: "information-circle", inactive: "information-circle-outline" },
};

// Visual left→right order of the menu. Library is first (and the landing); the
// brand logo is rendered before this row and links to Library (home).
const ORDER = ["library", "books", "settings", "help", "about"];

// Top, center-aligned navigation bar with square icon+label tiles and a leading
// Mentible mark that jumps to Library (home). Replaces the default bottom tab bar
// (passed to <Tabs tabBar={…}>); horizontally scrollable so items don't cramp a phone.
export function TopNavBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
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
          style={styles.logoBtn}
        >
          <Image
            source={require("../../assets/brand/mentible-icon-1024-redorange.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </Pressable>

        {ORDER.map((name) => {
          const cfg = TABS[name];
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
                color={focused ? colors.tileOnGlyph : colors.tileOffGlyph}
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

const styles = StyleSheet.create({
  bar: {
    // Darkest token so the lighter tiles read as raised buttons against it.
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  // flexGrow + center → centered when the row fits, scrollable when it overflows.
  row: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  logoBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.tileOffFace,
    borderWidth: 2,
    borderTopColor: colors.tileOffFace,
    borderLeftColor: colors.tileOffFace,
    borderBottomColor: colors.tileOffShadow,
    borderRightColor: colors.tileOffShadow,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.xs,
  },
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
    backgroundColor: colors.tileOffFace,
    borderWidth: 2,
    borderTopColor: colors.tileOffFace,
    borderLeftColor: colors.tileOffFace,
    borderBottomColor: colors.tileOffShadow,
    borderRightColor: colors.tileOffShadow,
    justifyContent: "center",
    alignItems: "center",
    gap: 3,
  },
  tileActive: {
    backgroundColor: colors.tileOnFace,
    borderTopColor: colors.tileOnLo,
    borderLeftColor: colors.tileOnLo,
    borderBottomColor: colors.tileOnHi,
    borderRightColor: colors.tileOnHi,
  },
  tileLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.tileOffGlyph,
  },
  tileLabelActive: { color: colors.tileOnGlyph },
});
