import React, { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { HELP_TOPICS } from "@/constants/helpContent";
import { colors, radius, spacing, typography } from "@/constants/theme";

const SEEN_KEY = "mentible_onboarding_seen_v1";

// Reuse the canonical "getting started" steps from the help content so the
// onboarding never drifts from Help.
function gettingStartedSteps(): string[] {
  const topic = HELP_TOPICS.find((t) => t.id === "getting-started");
  const block = topic?.blocks.find((b) => b.kind === "steps");
  return block && block.kind === "steps" ? block.steps : [];
}

// First-run walkthrough (issue #60). Shows once, then records a flag in
// AsyncStorage. Mounted in the root layout so it overlays whichever tab the app
// lands on.
export function OnboardingModal() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const steps = gettingStartedSteps();

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => {
        if (active && !v) setVisible(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(async () => {
    setVisible(false);
    try {
      await AsyncStorage.setItem(SEEN_KEY, "1");
    } catch {
      // A failed write just means the intro may show again — not fatal.
    }
  }, []);

  const addKey = useCallback(async () => {
    await dismiss();
    router.push("/settings");
  }, [dismiss, router]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Image
            source={require("../../assets/brand/mentible-icon-1024-redorange.png")}
            style={styles.mark}
            resizeMode="contain"
            accessibilityLabel={BRAND_NAME}
          />
          <Text style={styles.title}>Welcome to {BRAND_NAME}</Text>
          <Text style={styles.tagline}>{BRAND_TAGLINE}</Text>
          <Text style={styles.subtitle}>
            Turn what you want to learn into a real, rendered lesson — not a chat reply.
            Here&apos;s the flow:
          </Text>

          <View style={styles.steps}>
            {steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}
          </View>

          <Pressable
            style={styles.primaryBtn}
            onPress={addKey}
            accessibilityRole="button"
            accessibilityLabel="Add your Anthropic key in Settings"
          >
            <Text style={styles.primaryBtnText}>Add your Anthropic key</Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss the intro"
            hitSlop={8}
          >
            <Text style={styles.laterText}>I&apos;ll explore first</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mark: { width: 64, height: 64, alignSelf: "center" },
  title: {
    fontSize: typography.sizeXl,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  tagline: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.primary,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  subtitle: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  steps: { gap: spacing.sm, marginBottom: spacing.sm },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary + "33",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeXs },
  stepText: { flex: 1, fontSize: typography.sizeSm, color: colors.text, lineHeight: 21 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
  laterText: {
    color: colors.textSecondary,
    fontSize: typography.sizeSm,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
});
