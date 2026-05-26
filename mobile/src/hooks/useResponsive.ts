import { useWindowDimensions } from "react-native";
import { BREAKPOINTS } from "@/constants/layout";

export interface Responsive {
  width: number;
  isTablet: boolean; // ≥ 768 — start widening / centering
  isDesktop: boolean; // ≥ 1024 — multi-column layouts
}

// Width-based responsiveness. RN/react-native-web has no CSS media queries, so
// layout decisions key off the live window width. Drives the desktop web layout
// while leaving phone rendering untouched (both flags false on a phone).
export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();
  return {
    width,
    isTablet: width >= BREAKPOINTS.tablet,
    isDesktop: width >= BREAKPOINTS.desktop,
  };
}
