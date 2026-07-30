import * as Clipboard from "expo-clipboard";

// Copy plain text to the system clipboard. Isolated behind this wrapper so the
// screen depends on `@/lib/clipboard` (mockable) rather than the native module,
// and so a web build has one place to swap the impl if ever needed.
// expo-clipboard's setStringAsync is web-safe (uses the Clipboard API).
export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
