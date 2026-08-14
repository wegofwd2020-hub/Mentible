import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { DefaultTheme as NavDefaultTheme, ThemeProvider as NavThemeProvider } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { AuthProvider } from "@/auth/AuthProvider";
import { AppBackground } from "@/components/AppBackground";
import { StudioHeader } from "@/components/StudioHeader";
import { DeviceReporter } from "@/device/DeviceReporter";
import { FirstRunWizard } from "@/onboarding/FirstRunWizard";
import { useSeedDefaultLibrary } from "@/hooks/useSeedDefaultLibrary";
import { useSeedStarterSources } from "@/hooks/useSeedStarterSources";
import { FONT_ASSETS } from "@/constants/fonts";
import { applyGlobalFont } from "@/lib/applyGlobalFont";
import { registerWebFonts } from "@/lib/webFonts";
import { loadFontMode, useFontMode } from "@/state/fontMode";
import { studioLightColors } from "@/constants/theme";
import { ThemeProvider, useThemeControls } from "@/theme";

// Status-bar icons must contrast with the theme ground: dark icons on the light
// (cream) default, light icons on the dark (navy) theme. Lives inside ThemeProvider
// so it reacts to a switch. (StatusBar is a no-op on web.)
function ThemedStatusBar() {
  const { themeName } = useThemeControls();
  return <StatusBar style={themeName === "studio-dark" ? "light" : "dark"} />;
}

// Install the global text-font interceptor before any component renders (native-only).
applyGlobalFont();
// Register the canonical @font-face families + Inter default (web-only; no-op on native).
registerWebFonts();

// React Navigation's OWN default theme (separate from our `@/theme` ThemeProvider)
// paints `colors.background` (`rgb(242, 242, 242)`, React Navigation's stock light
// grey) behind every Stack/Tabs scene via `@react-navigation/elements`'s `Background`
// component — a layer BELOW our `contentStyle`/`sceneStyle` overrides that stayed
// invisible only because every screen used to paint its own opaque `c.background`
// fill. Now that those fills are transparent (Slice B, lovable-background), that
// grey shows through as an un-themed flat scrim behind the gradient on both
// light AND dark. Overriding `colors.background` to transparent here removes it —
// our own `AppBackground` gradient is the only background painted from here down.
const NAV_THEME = { ...NavDefaultTheme, colors: { ...NavDefaultTheme.colors, background: "transparent" } };

export default function RootLayout() {
  // Seed the default shareable library on first run (ADR-017, #111).
  useSeedDefaultLibrary();
  // Seed the owner-curated starter shelves on first run (spec P0-5, ADR-028).
  useSeedStarterSources();
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
    return <View style={{ flex: 1, backgroundColor: studioLightColors.background }} />;
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <ThemedStatusBar />
        {/* Re-key on the font mode so flipping the dyslexia toggle re-applies the
            interceptor across the whole tree immediately. */}
        <AppBackground>
          <NavThemeProvider value={NAV_THEME}>
            <Stack
              key={dyslexic ? "font-dyslexic" : "font-default"}
              screenOptions={{
                header: (props) => <StudioHeader {...props} />,
                contentStyle: { backgroundColor: "transparent" },
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
              <Stack.Screen name="shelves/[sourceId]" options={{ headerShown: false }} />
              <Stack.Screen name="shelves/[sourceId]/[entryId]" options={{ headerShown: false }} />
              <Stack.Screen name="shelves/downloads" options={{ headerShown: false }} />
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
              <Stack.Screen
                name="paywall"
                options={{ title: "Plans", headerBackTitle: "Settings" }}
              />
              <Stack.Screen
                name="admin"
                options={{ title: "Admin", headerBackTitle: "Account" }}
              />
              <Stack.Screen
                name="admin/[sub]"
                options={{ title: "User", headerBackTitle: "Users" }}
              />
              <Stack.Screen
                name="trust/new"
                options={{ title: "New project", headerBackTitle: "Projects" }}
              />
              <Stack.Screen
                name="trust/[projectId]"
                options={{ title: "Project", headerBackTitle: "Reviews" }}
              />
              <Stack.Screen
                name="trust/version/[versionId]"
                options={{ title: "Draft", headerBackTitle: "Project" }}
              />
            </Stack>
          </NavThemeProvider>
        </AppBackground>
        {/* First-run onboarding (sign up → add a key → reading tour). The wizard
            self-manages which steps apply per build (demo / unconfigured auth), so
            no environment gate is needed here. */}
        <FirstRunWizard />
        {/* Reports this install's device to the backend when signed in (admin view). */}
        <DeviceReporter />
      </AuthProvider>
    </ThemeProvider>
  );
}
