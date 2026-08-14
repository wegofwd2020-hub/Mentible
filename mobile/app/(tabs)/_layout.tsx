import { Tabs } from "expo-router";
import { TopNavBar } from "@/components/TopNavBar";
import { SideNav } from "@/components/SideNav";
import { useResponsive } from "@/hooks/useResponsive";

// Navigation swaps by width: a custom TOP, center-aligned bar (TopNavBar) with
// square icon+label tiles and a leading Mentible mark on narrow/tablet widths,
// or a left SideNav on desktop widths (useResponsive().isDesktop). Headers are
// hidden — the active nav tile/row indicates the current screen. Declaration
// order here doesn't drive the visual order; TopNavBar/SideNav render an
// explicit sequence.
//
// `sceneStyle` is TRANSPARENT (Slice B, lovable-background) so the root
// `AppBackground` gradient (mounted above the Stack in `app/_layout.tsx`)
// shows through every tab. Previously this painted the selected theme's flat
// `background` so a themed page with no background of its own wouldn't fall
// back to React Navigation's device-colour-scheme default; that job now
// belongs to `AppBackground`, which every theme (including the flat,
// non-Studio ones) still resolves correctly via its `bgGradientEnd ?? background`
// fallback.
export default function TabLayout() {
  const { isDesktop } = useResponsive();
  return (
    <Tabs
      tabBar={(props) => (isDesktop ? <SideNav {...props} /> : <TopNavBar {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? "left" : "top",
        sceneStyle: { backgroundColor: "transparent" },
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
