import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { AuthProvider } from "@/auth/AuthProvider";
import { OnboardingModal } from "@/components/OnboardingModal";
import { useSeedDefaultLibrary } from "@/hooks/useSeedDefaultLibrary";
import { FONT_ASSETS } from "@/constants/fonts";
import { applyGlobalFont } from "@/lib/applyGlobalFont";
import { loadFontMode, useFontMode } from "@/state/fontMode";
import { colors } from "@/constants/theme";

// Install the global text-font interceptor before any component renders (native-only).
applyGlobalFont();

export default function RootLayout() {
  // Seed the default shareable library on first run (ADR-017, #111).
  useSeedDefaultLibrary();
  const [fontsLoaded] = useFonts(FONT_ASSETS);
  const [modeReady, setModeReady] = useState(false);
  const { dyslexic } = useFontMode();

  // Hydrate the dyslexia toggle before first paint so fonts are correct immediately.
  useEffect(() => {
    void loadFontMode().finally(() => setModeReady(true));
  }, []);

  // Hold first paint until bundled fonts + the saved mode are ready (matches the
  // splash background to avoid a flash of system-font text).
  if (!fontsLoaded || !modeReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <AuthProvider>
      <StatusBar style="light" />
      {/* Re-key on the font mode so flipping the dyslexia toggle re-applies the
          interceptor across the whole tree immediately. */}
      <Stack
        key={dyslexic ? "font-dyslexic" : "font-default"}
        screenOptions={{
          headerStyle: { backgroundColor: "#0f172a" },
          headerTintColor: "#f1f5f9",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: "#0f172a" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="concepts"
          options={{
            title: "UI concepts (prototype)",
            headerBackTitle: "Settings",
          }}
        />
        <Stack.Screen
          name="diagram-types"
          options={{
            title: "Diagram types",
            headerBackTitle: "Help",
          }}
        />
        <Stack.Screen
          name="book/new"
          options={{
            title: "New book",
            headerBackTitle: "Studio",
          }}
        />
        <Stack.Screen
          name="book/saved/[id]"
          options={{
            title: "Edit book",
            headerBackTitle: "Studio",
          }}
        />
        <Stack.Screen
          name="book/generate/[id]"
          options={{
            title: "Write topics",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="book/topic/[bookId]/[topicId]"
          options={{
            title: "Topic",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="book/read/[id]"
          options={{
            title: "Read",
            headerBackTitle: "Library",
          }}
        />
        <Stack.Screen
          name="book/reviews/[id]"
          options={{
            title: "Reviews",
            headerBackTitle: "Library",
          }}
        />
        <Stack.Screen
          name="sign-in"
          options={{ title: "Sign in", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="account"
          options={{ title: "Account", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="usage"
          options={{ title: "Usage", headerBackTitle: "Settings" }}
        />
      </Stack>
      <OnboardingModal />
    </AuthProvider>
  );
}
