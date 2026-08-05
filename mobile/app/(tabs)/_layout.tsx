import { Tabs } from "expo-router";
import { TopNavBar } from "@/components/TopNavBar";
import { SideNav } from "@/components/SideNav";
import { useResponsive } from "@/hooks/useResponsive";
import { useTheme } from "@/theme";

// Navigation swaps by width: a custom TOP, center-aligned bar (TopNavBar) with
// square icon+label tiles and a leading Mentible mark on narrow/tablet widths,
// or a left SideNav on desktop widths (useResponsive().isDesktop). Headers are
// hidden — the active nav tile/row indicates the current screen. Declaration
// order here doesn't drive the visual order; TopNavBar/SideNav render an
// explicit sequence.
//
// `sceneStyle` paints the SELECTED THEME's background on the tab scene container.
// Without it, the bottom-tab scene falls back to React Navigation's default scene
// background (which follows the device colour scheme), and — because a tab screen
// that paints no background of its own would show through — the page would ignore
// the user's chosen theme. Sourcing it from `useTheme()` (not the static `colors`)
// makes every tab follow the selected theme at the source; previously it was
// pinned to the Study palette, so themed pages that set their own background
// changed but plain ones (e.g. Posts) stayed dark.
export default function TabLayout() {
  const { isDesktop } = useResponsive();
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => (isDesktop ? <SideNav {...props} /> : <TopNavBar {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? "left" : "top",
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="shelves" />
      <Tabs.Screen name="books" />
      <Tabs.Screen name="projects" />
      <Tabs.Screen name="reviews" />
      <Tabs.Screen name="posts" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="help" />
      <Tabs.Screen name="about" />
    </Tabs>
  );
}
