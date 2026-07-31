import React, { useMemo } from "react";
import { themes } from "@/constants/theme";
import { ThemeContext } from "./ThemeProvider";

// ADR-038 O1: the SME / trust surfaces always render in the "Navy Trust" brand,
// regardless of the user's global theme choice. This thin scope overrides the
// ThemeContext for its subtree with a FIXED navy-trust palette — no persistence,
// and `setTheme` is a no-op (you cannot switch theme away from inside the SME
// surfaces; the global switcher governs the learner surfaces only).
export function SmeThemeScope({ children }: { children: React.ReactNode }): React.JSX.Element {
  const value = useMemo(
    () => ({ theme: themes["navy-trust"], themeName: "navy-trust" as const, setTheme: () => {} }),
    [],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
