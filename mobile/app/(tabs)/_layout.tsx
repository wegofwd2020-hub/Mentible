import { Tabs } from "expo-router";
import { TopNavBar } from "@/components/TopNavBar";
import { SideNav } from "@/components/SideNav";
import { useResponsive } from "@/hooks/useResponsive";
import { colors } from "@/constants/theme";

// Navigation swaps by width: a custom TOP, center-aligned bar (TopNavBar) with
// square icon+label tiles and a leading Mentible mark on narrow/tablet widths,
// or a left SideNav on desktop widths (useResponsive().isDesktop). Headers are
// hidden — the active nav tile/row indicates the current screen. Declaration
// order here doesn't drive the visual order; TopNavBar/SideNav render an
// explicit sequence.
//
// `sceneStyle` paints the app's dark background on the tab scene container.
// Without it, the bottom-tab scene falls back to React Navigation's default
// scene background — which follows the DEVICE colour scheme (white on a
// light-mode device). The app palette is always dark (near-white `colors.text`),
// so any tab screen that doesn't paint its own background would render invisible
// text on a light-mode device. Setting it here fixes every tab at the source.
export default function TabLayout() {
  const { isDesktop } = useResponsive();
  return (
    <Tabs
      tabBar={(props) => (isDesktop ? <SideNav {...props} /> : <TopNavBar {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? "left" : "top",
        sceneStyle: { backgroundColor: colors.background },
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
