import { Platform, type LayoutChangeEvent } from "react-native";
import { setSectionOffset } from "./landingScroll";

// On web, expose an `id` so the top-bar links can `scrollIntoView`. On native,
// there's no DOM — instead record the section's vertical offset via `onLayout`
// so the nav's marketing links can scroll the LandingHome ScrollView to it
// (see `landingScroll.ts` + `navState.goToAnchor`).
export const sectionAnchor = (id: string) =>
  Platform.OS === "web"
    ? ({ nativeID: id } as const)
    : ({
        onLayout: (e: LayoutChangeEvent) => setSectionOffset(id, e.nativeEvent.layout.y),
      } as const);
