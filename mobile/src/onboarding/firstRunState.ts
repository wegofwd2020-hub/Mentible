import AsyncStorage from "@react-native-async-storage/async-storage";

// First-run onboarding progress (the chained "sign up → add a key → take the
// tour" flow). Unlike the old single show-once OnboardingModal, each step tracks
// its own status so the flow is resumable: close the app mid-flow and the next
// launch picks up at the first step that is still `pending`. A step is `skipped`
// when the user dismisses it (won't auto-return; relaunch from Help) and `done`
// when completed.

export type StepStatus = "pending" | "done" | "skipped";
export type StepId = "signup" | "key" | "tour";

// Display + resume order.
export const STEP_ORDER: readonly StepId[] = ["signup", "key", "tour"] as const;

export interface FirstRunState {
  version: number;
  signup: StepStatus;
  key: StepStatus;
  tour: StepStatus;
}

const STORAGE_KEY = "mentible_firstrun_v1";
// The previous, single-flag onboarding (OnboardingModal). If a returning user
// already saw it, we don't want to nag them with the full new flow.
const LEGACY_ONBOARDING_KEY = "mentible_onboarding_seen_v1";
const CURRENT_VERSION = 1;

const FRESH: FirstRunState = {
  version: CURRENT_VERSION,
  signup: "pending",
  key: "pending",
  tour: "pending",
};

// Returning users (saw the legacy modal) start fully skipped — they reach any
// wizard on demand from Help instead of being interrupted.
const ALL_SKIPPED: FirstRunState = {
  version: CURRENT_VERSION,
  signup: "skipped",
  key: "skipped",
  tour: "skipped",
};

function coerce(value: unknown): StepStatus {
  return value === "done" || value === "skipped" ? value : "pending";
}

function normalize(parsed: Partial<FirstRunState> | null): FirstRunState {
  return {
    version: CURRENT_VERSION,
    signup: coerce(parsed?.signup),
    key: coerce(parsed?.key),
    tour: coerce(parsed?.tour),
  };
}

// Subscribers (the mounted FirstRunWizard) are notified on every state change so
// re-arming a step from Help (relaunchStep) re-shows the wizard without a reload.
type Listener = (state: FirstRunState) => void;
const listeners = new Set<Listener>();

export function subscribeFirstRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function persist(state: FirstRunState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A failed write just means the flow may re-show next launch — not fatal.
  }
  listeners.forEach((fn) => fn(state));
}

// Load (or first-time seed) the first-run state. On the very first call with no
// stored record we seed once: returning users (legacy flag present) → all
// skipped; brand-new installs → fresh.
export async function loadFirstRunState(): Promise<FirstRunState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw) as Partial<FirstRunState>);

    const sawLegacy = await AsyncStorage.getItem(LEGACY_ONBOARDING_KEY);
    const seed = sawLegacy ? ALL_SKIPPED : FRESH;
    await persist(seed);
    return seed;
  } catch {
    return FRESH; // storage unavailable: behave as a fresh run (best-effort).
  }
}

export async function setStepStatus(step: StepId, status: StepStatus): Promise<FirstRunState> {
  const current = await loadFirstRunState();
  const next: FirstRunState = { ...current, [step]: status };
  await persist(next);
  return next;
}

// Persist several step changes at once (used by the coordinator's environment
// auto-skips, e.g. demo build / signed-in already), avoiding intermediate writes.
export async function applyStepStatuses(
  updates: Partial<Record<StepId, StepStatus>>,
): Promise<FirstRunState> {
  const current = await loadFirstRunState();
  const next: FirstRunState = { ...current, ...updates };
  await persist(next);
  return next;
}

export function firstPendingStep(state: FirstRunState): StepId | null {
  return STEP_ORDER.find((id) => state[id] === "pending") ?? null;
}

export function isComplete(state: FirstRunState): boolean {
  return STEP_ORDER.every((id) => state[id] !== "pending");
}

// Re-arm a single step (used by the "Start the walkthrough" buttons in Help).
export async function relaunchStep(step: StepId): Promise<FirstRunState> {
  return setStepStatus(step, "pending");
}

export async function resetFirstRun(): Promise<FirstRunState> {
  await persist(FRESH);
  return FRESH;
}
