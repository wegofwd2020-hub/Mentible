import React from "react";
import { StyleSheet, Text } from "react-native";
import { FRAUNCES_ITALIC } from "@/constants/fonts";

// The editorial "accent word" (ADR-038 O2): an italic-Fraunces word set inside a
// headline for emphasis — the export's replacement for the old gold underline
// (which overlapped text; do NOT bring the underline back).
//
// Inline by design: render it INSIDE a heading <Text> so it inherits the
// heading's size + colour, overriding only the family to italic Fraunces:
//   <Text style={styles.heading}>No <AccentText>projects</AccentText> yet.</Text>
//
// The slant is baked into the family name — no fontStyle:"italic" (that would
// synthesise a double-italic on web on top of the already-italic glyphs, the same
// trap as a redundant fontWeight). The native text interceptor keeps this exact
// family and still swaps it to OpenDyslexic in dyslexic mode (a11y).
export function AccentText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text style={styles.accent}>{children}</Text>;
}

const styles = StyleSheet.create({
  accent: { fontFamily: FRAUNCES_ITALIC.semibold },
});
