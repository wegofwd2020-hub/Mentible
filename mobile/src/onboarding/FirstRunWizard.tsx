import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { IS_DEMO } from "@/constants/demo";
import { spacing } from "@/constants/theme";
import {
  applyStepStatuses,
  firstPendingStep,
  loadFirstRunState,
  setStepStatus,
  STEP_ORDER,
  subscribeFirstRun,
  type FirstRunState,
  type StepId,
} from "./firstRunState";
import { KeyStep } from "./steps/KeyStep";
import { SignupStep } from "./steps/SignupStep";
import { TourStep } from "./steps/TourStep";
import type { WizardStepProps } from "./steps/types";

// First-run onboarding coordinator. Replaces the old single OnboardingModal: it
// chains three skippable, resumable steps (sign up → add an LLM key → reading
// tour), showing the first step that is still `pending` and closing once they
// are all done or skipped. Each step renders its own scaffold/body and reports
// back via onDone/onSkip; this component owns the Modal, persisted progress, and
// which step is visible.
const STEP_COMPONENTS: Record<StepId, React.ComponentType<WizardStepProps>> = {
  signup: SignupStep,
  key: KeyStep,
  tour: TourStep,
};

export function FirstRunWizard() {
  const { status } = useAuth();
  const [state, setState] = useState<FirstRunState | null>(null);

  // Load persisted progress once, and stay subscribed so re-arming a step from
  // Help (relaunchStep) re-shows the wizard live, without a reload.
  useEffect(() => {
    let active = true;
    void loadFirstRunState().then((s) => {
      if (active) setState(s);
    });
    const unsubscribe = subscribeFirstRun((s) => {
      if (active) setState(s);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Environment-driven auto-skips so the flow never dead-ends on a step the build
  // can't run: a signed-in user has signup done; when auth is unavailable
  // (unconfigured build) signup can't run; the demo build also has BYOK disabled,
  // so skip the key step too. Only `pending` steps are touched, so this can't
  // loop.
  useEffect(() => {
    if (!state) return;
    const updates: Partial<Record<StepId, "done" | "skipped">> = {};
    if (state.signup === "pending") {
      if (status === "signed_in") updates.signup = "done";
      else if (status === "unavailable" || IS_DEMO) updates.signup = "skipped";
    }
    if (IS_DEMO && state.key === "pending") updates.key = "skipped";
    if (Object.keys(updates).length > 0) {
      void applyStepStatuses(updates).then(setState);
    }
  }, [state, status]);

  // The step to display. While auth is still resolving we hold signup back rather
  // than flashing it (the effect above will finalize signup once status settles).
  const visibleStep = useMemo<StepId | null>(() => {
    if (!state) return null;
    const step = firstPendingStep(state);
    if (step === "signup" && status === "loading") return null;
    return step;
  }, [state, status]);

  if (!state || !visibleStep) return null;

  const StepComponent = STEP_COMPONENTS[visibleStep];
  const advance = (next: "done" | "skipped") => {
    void setStepStatus(visibleStep, next).then(setState);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => advance("skipped")}>
      <View style={styles.overlay}>
        <StepComponent
          stepIndex={STEP_ORDER.indexOf(visibleStep)}
          stepCount={STEP_ORDER.length}
          onDone={() => advance("done")}
          onSkip={() => advance("skipped")}
        />
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
    // Narrower side gutters than vertical so the card is wider on a phone (where
    // the card's maxWidth never applies) — gives the dense "Add an LLM key" step
    // more horizontal room. Keeps a comfortable edge margin.
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
});
