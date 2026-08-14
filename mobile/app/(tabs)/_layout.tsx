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
// `sceneStyle` MUST be OPAQUE (the theme's flat `background`). On web,
// `react-native-screens` is inactive, so `bottom-tabs` can't detach inactive
// tab scenes — `MaybeScreen` falls back to a plain `<View style={[absoluteFill,
// { zIndex: isFocused ? 0 : -1 }]}>` and EVERY tab scene stays mounted, stacked,
// and visible; only the active scene's opaque fill hides the ones beneath it.
// Slice B (lovable-background) briefly made this `transparent` to let the root
// `AppBackground` gradient show through — but that removed the only thing hiding
// inactive tabs on web, so Shelves/Library/Projects all rendered on top of each
// other (reported 2026-08-14). The gradient still shows on every non-(tabs)
// Stack route; the tab surfaces use the flat theme ground.
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
