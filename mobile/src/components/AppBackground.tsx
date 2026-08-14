import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/theme";

// The app's root background: a subtle top-to-bottom gradient from the active
// palette's `background` to its warmer `bgGradientEnd` (see `mix()` in
// `constants/theme.ts`). Palettes that don't opt in (most non-Studio ones)
// have `bgGradientEnd` unset, so the gradient degenerates to a flat fill —
// pixel-equivalent to the old solid-color root. Screens must render their own
// outer container as `transparent` for the gradient to show through.
export function AppBackground({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={[t.background, t.bgGradientEnd ?? t.background]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      {children}
    </LinearGradient>
  );
}
