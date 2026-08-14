import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { themes, type Palette, type ThemeName } from "@/constants/theme";
import { loadThemeName, saveThemeName } from "./themeStore";

interface ThemeContextValue {
  theme: Palette;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

// Default = Studio (light/cream), so useTheme() outside a provider returns
// the current look (the compat shim: un-migrated screens/tests never crash
// and never change). Exported so a scoped provider (e.g. SmeThemeScope) can
// force a fixed theme over a subtree without going through the persisted
// global ThemeProvider.
export const ThemeContext = createContext<ThemeContextValue>({
  theme: themes["studio-light"],
  themeName: "studio-light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [themeName, setThemeName] = useState<ThemeName>("studio-light");

  // Apply the persisted choice once resolved. No render gate — a one-frame
  // Studio default before the stored value lands is acceptable.
  useEffect(() => {
    let alive = true;
    void loadThemeName().then((n) => {
      if (alive && n) setThemeName(n);
    });
    return () => { alive = false; };
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    void saveThemeName(name);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[themeName], themeName, setTheme }),
    [themeName, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext).theme;
}

export function useThemeControls(): { themeName: ThemeName; setTheme: (n: ThemeName) => void } {
  const { themeName, setTheme } = useContext(ThemeContext);
  return { themeName, setTheme };
}

// Ergonomic replacement for a module-level StyleSheet.create(...colors...):
// `const styles = useThemedStyles(makeStyles)` recomputes when the theme changes.
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [theme, factory]);
}
