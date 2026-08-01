import React from "react";
import { Pressable, Text, View } from "react-native";
import type { PlanOffer } from "@/billing/types";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

interface Props {
  offer: PlanOffer;
  selected: boolean;
  onSelect: (id: string) => void;
}

// One selectable plan. Purely presentational — it renders the offer and reports taps.
// It deliberately does NOT render `offer.renewalTerms`: store policy wants price, period
// and renewal disclosed *adjacent to the purchase button*, so the screen owns that line.
export function PlanCard({ offer, selected, onSelect }: Props) {
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) => ({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardSelected: { borderColor: c.brand, backgroundColor: c.surfaceHigh },
  head: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  dot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: c.textMuted,
  },
  dotSelected: { borderColor: c.brand, backgroundColor: c.brand },
  title: { color: c.text, fontSize: typography.sizeMd, fontWeight: "700" as const },
  badge: {
    backgroundColor: c.brand + "22",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { color: c.text, fontSize: typography.sizeXs, fontWeight: "600" as const },
  price: { color: c.text, fontSize: typography.sizeLg, fontWeight: "700" as const },
  blurb: { color: c.textMuted, fontSize: typography.sizeSm, lineHeight: 19 },
});
