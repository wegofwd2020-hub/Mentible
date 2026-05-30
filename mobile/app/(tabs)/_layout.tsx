import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

// A tab icon that fills in when the tab is active and is outlined otherwise.
function tabIcon(active: IconName, inactive: IconName) {
  return function TabBarIcon({
    color,
    size,
    focused,
  }: {
    color: string;
    size: number;
    focused: boolean;
  }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
  };
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#1e293b",
          borderTopColor: "#334155",
        },
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#64748b",
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f1f5f9",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          // Header hidden: the home screen renders its own branded hero.
          headerShown: false,
          tabBarLabel: "Query",
          tabBarIcon: tabIcon("sparkles", "sparkles-outline"),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarLabel: "Library",
          tabBarIcon: tabIcon("bookmarks", "bookmarks-outline"),
        }}
      />
      <Tabs.Screen
        name="books"
        options={{
          title: "Books",
          tabBarLabel: "Books",
          tabBarIcon: tabIcon("book", "book-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarLabel: "Settings",
          tabBarIcon: tabIcon("settings", "settings-outline"),
        }}
      />
    </Tabs>
  );
}
