import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PlanOffer } from "@/billing/types";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface Props {
  offer: PlanOffer;
  selected: boolean;
  onSelect: (id: string) => void;
}

// One selectable plan. Purely presentational — it renders the offer and reports taps.
// It deliberately does NOT render `offer.renewalTerms`: store policy wants price, period
// and renewal disclosed *adjacent to the purchase button*, so the screen owns that line.
export function PlanCard({ offer, selected, onSelect }: Props) {
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={() => onSelect(offer.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${offer.title}, ${offer.price}`}
    >
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <View style={[styles.dot, selected && styles.dotSelected]} />
          <Text style={styles.title}>{offer.title}</Text>
        </View>
        {offer.badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{offer.badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.price}>{offer.price}</Text>
      <Text style={styles.blurb}>{offer.blurb}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.brand, backgroundColor: colors.surfaceHigh },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  dotSelected: { borderColor: colors.brand, backgroundColor: colors.brand },
  title: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "700" },
  badge: {
    backgroundColor: colors.brand + "22",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { color: colors.text, fontSize: typography.sizeXs, fontWeight: "600" },
  price: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "700" },
  blurb: { color: colors.textMuted, fontSize: typography.sizeSm, lineHeight: 19 },
});
