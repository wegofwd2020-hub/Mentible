import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "@/constants/theme";

// A small contextual "?" affordance. Tapping it opens Help deep-linked to a
// specific topic (Help scrolls to + highlights it). Place one near the feature
// it explains. `topic` is a help topic id (see constants/helpContent.ts).
export function HelpButton({
  topic,
  label = "Help",
}: {
  topic: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/help", params: { topic } })}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${label} — open help`}
      style={styles.btn}
    >
      <Ionicons name="help-circle-outline" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 2 },
});
