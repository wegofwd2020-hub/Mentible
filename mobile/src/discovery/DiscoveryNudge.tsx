import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, typography } from "@/constants/theme";

// A proactive, dismissible discovery callout (F3) — unlike HelpHint (passive
// tap-to-reveal), this advertises an action the user may not know exists. It
// sits next to the real control; dismissal is owned by the caller (useNudge).
export interface DiscoveryNudgeProps {
  text: string;
  onDismiss: () => void;
  testID?: string;
}

export function DiscoveryNudge({ text, onDismiss, testID }: DiscoveryNudgeProps) {
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
      <Text style={styles.text}>{text}</Text>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss hint"
        testID={testID ? `${testID}-dismiss` : undefined}
      >
        <Text style={styles.dismiss}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary + "1A", // translucent primary tint (cf. TourStep's +"33")
    marginVertical: spacing.sm,
  },
  text: { flex: 1, color: colors.text, fontSize: typography.sizeSm },
  dismiss: { color: colors.textSecondary, fontSize: typography.sizeMd, fontWeight: "700", paddingHorizontal: spacing.xs },
});
