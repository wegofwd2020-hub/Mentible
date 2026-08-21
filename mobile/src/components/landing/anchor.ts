import { Platform } from "react-native";

// On web, expose an id so top-bar links can scrollIntoView; native no-op.
export const sectionAnchor = (id: string) =>
  Platform.OS === "web" ? ({ nativeID: id } as const) : ({} as const);
