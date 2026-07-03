import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/auth/AuthProvider";
import { AuthForm } from "@/components/AuthForm";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { WizardScaffold } from "../WizardScaffold";
import type { WizardStepProps } from "./types";

// Step 1 of the first run: create an account (or sign in). The form carries its
// own CTAs, so this step supplies no scaffold primary button. A successful
// sign-in flips auth status to "signed_in", which the coordinator detects and
// uses to mark this step done + advance — so we don't call onDone ourselves.
//
// An email sign-up may instead require confirmation before a session exists; in
// that case status stays signed_out and we surface a "check your email" hint.
export function SignupStep({ stepIndex, stepCount, onSkip }: WizardStepProps) {
  const { status } = useAuth();
  const [pendingConfirm, setPendingConfirm] = useState(false);

  // While this step is mounted the user is not yet signed in (the coordinator
  // unmounts it the moment status becomes "signed_in"). So a no-error sign-up
  // that left us un-signed-in means email confirmation is required.
  const showConfirmHint = pendingConfirm && status !== "signed_in";

  return (
    <WizardScaffold
      stepIndex={stepIndex}
      stepCount={stepCount}
      title="Create your account"
      subtitle="Optional — your Library already has two books to read. Sign in to sync across devices and to author your own. You can also skip and set this up later."
      helpTopic="getting-started-account"
      onSkip={onSkip}
    >
      <AuthForm
        showHeader={false}
        initialMode="sign_up"
        onAuthenticated={({ mode }) => setPendingConfirm(mode === "sign_up")}
      />
      {showConfirmHint ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Ionicons name="mail-outline" size={18} color={colors.primary} style={styles.hintIcon} />
          <Text style={styles.hintText}>
            Almost there — check your email and tap the confirmation link, then sign in to finish.
            You can also Skip for now and confirm later.
          </Text>
        </View>
      ) : null}
    </WizardScaffold>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.primary + "1a",
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  hintIcon: { marginTop: 1 },
  hintText: { flex: 1, fontSize: typography.sizeSm, color: colors.text, lineHeight: 20 },
});
