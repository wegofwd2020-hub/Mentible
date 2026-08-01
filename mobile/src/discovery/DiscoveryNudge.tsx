import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// A proactive, dismissible discovery callout (F3) — unlike HelpHint (passive
// tap-to-reveal), this advertises an action the user may not know exists. It
// sits next to the real control; dismissal is owned by the caller (useNudge).
export interface DiscoveryNudgeProps {
  text: string;
  onDismiss: () => void;
  testID?: string;
}

export function DiscoveryNudge({ text, onDismiss, testID }: DiscoveryNudgeProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
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

const makeStyles = (c: Palette) => ({
  wrap: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.primary + "1A",
    marginVertical: spacing.sm,
  },
  text: { flex: 1 as const, color: c.text, fontSize: typography.sizeSm },
  dismiss: { color: c.textSecondary, fontSize: typography.sizeMd, fontWeight: "700" as const, paddingHorizontal: spacing.xs },
});
