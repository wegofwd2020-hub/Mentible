// Dyslexia-friendly font toggle (accessibility). The active value is held in a
// module variable so the global text interceptor (src/lib/applyGlobalFont) can read
// it synchronously at render time, and mirrored to AsyncStorage so the choice
// survives restarts. React screens use the useFontMode() hook.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "mentible.fontMode.dyslexic";

let dyslexic = false;
const listeners = new Set<(v: boolean) => void>();

// Read synchronously — used by the text interceptor on every render.
export function isDyslexic(): boolean {
  return dyslexic;
}

// Hydrate the in-memory value from storage. Call once at startup (before first paint).
export async function loadFontMode(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    dyslexic = raw === "1";
  } catch {
    dyslexic = false; // storage unavailable → safe default; not worth surfacing
  }
  listeners.forEach((l) => l(dyslexic)); // wake any consumer mounted before hydration
}

export function setDyslexic(next: boolean): void {
  dyslexic = next;
  listeners.forEach((l) => l(next));
  // Fire-and-forget persistence; a failed write just means it won't survive restart.
  void AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0").catch(() => {});
}

// Screen-facing state + setter. Re-renders the consumer when the mode changes.
export function useFontMode(): { dyslexic: boolean; setDyslexic: (v: boolean) => void } {
  const [value, setValue] = useState(dyslexic);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return { dyslexic: value, setDyslexic };
}
