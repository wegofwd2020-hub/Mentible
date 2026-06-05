import { Tabs } from "expo-router";
import { TopNavBar } from "@/components/TopNavBar";

// Navigation is a custom TOP, center-aligned bar (TopNavBar) with square
// icon+label tiles and a leading Mentible mark. Headers are hidden — the active
// nav tile indicates the current screen. Declaration order here doesn't drive
// the visual order; TopNavBar renders an explicit sequence.
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TopNavBar {...props} />}
      screenOptions={{ headerShown: false, tabBarPosition: "top" }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="books" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="help" />
      <Tabs.Screen name="about" />
    </Tabs>
  );
}
