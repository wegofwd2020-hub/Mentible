import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Label } from "@/components/ui/Label";
import { spacing, radius, typography } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

// Pinned constants (NOT theme tokens) — this mimics the product's real dark
// approval card regardless of the app's active theme, per the brief's Global
// Constraints.
const NAVY = "#0e1421";
const INK = "#f4f2ea";
const GOLD = "#d6a94b";
const MUTED = "#93a0b4";
const DIVIDER = "#22293b";

const ROWS: Array<[string, string, string]> = [
  ["PROVENANCE", "Recorded by the expert — not operator-on-behalf", "expert_self"],
  ["GROUNDING", "Every claim traced to a cited source", "checked"],
  ["COVERAGE", "Sections backed by a live source", "100%"],
  ["READABILITY", "Reading level", "accessible"],
];

export function ApprovalCardExample(): React.JSX.Element {
  return (
    <View style={styles.card} {...sectionAnchor("trust")}>
      <View style={styles.badgeRow}>
        <Label style={styles.badge}>Example</Label>
        <Text style={styles.eyebrow}>APPROVAL RECORD · ● Expert-validated</Text>
      </View>
      <Text style={styles.title}>Stormwater practice guide — Ch. 3, §2</Text>
      <Text style={styles.meta}>
        Revision 4 · approved by Dr. R. Patel (named expert) · recorded 12 Aug 2026
      </Text>
      <View style={styles.rows}>
        {ROWS.map(([label, desc, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowDesc}>{desc}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.quote}>
        "A version reads expert-validated only when the named expert records it. If the
        operator records it for them, it says operator-recorded. We never hide who signed
        off."
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    backgroundColor: NAVY,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: GOLD,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  badge: {
    color: GOLD,
  },
  eyebrow: {
    color: MUTED,
    fontSize: typography.sizeXs,
    letterSpacing: 1,
  },
  title: {
    color: INK,
    fontSize: typography.sizeLg,
    fontWeight: "600",
  },
  meta: {
    color: MUTED,
    fontSize: typography.sizeSm,
  },
  rows: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowLabel: {
    color: GOLD,
    fontSize: typography.sizeXs,
    fontWeight: "600",
    minWidth: 90,
  },
  rowDesc: {
    color: INK,
    fontSize: typography.sizeXs,
    flex: 1,
  },
  rowValue: {
    color: MUTED,
    fontSize: typography.sizeXs,
  },
  quote: {
    color: MUTED,
    fontSize: typography.sizeSm,
    fontStyle: "italic",
    lineHeight: typography.sizeSm * typography.lineHeightRelaxed,
  },
});
