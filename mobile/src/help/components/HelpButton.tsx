import React from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@/theme";

// A small contextual "?" affordance. Tapping it opens Help deep-linked to a
// specific topic (Help scrolls to + highlights it). Place one near the feature
// it explains. `topic` is a help topic id (see help-content/topics.ts).
export function HelpButton({
  topic,
  label = "Help",
}: {
  topic: string;
  label?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/help", params: { topic } })}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${label} — open help`}
      style={styles.btn}
    >
      <Ionicons name="help-circle-outline" size={22} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = {
  btn: { padding: 2 as const },
};
