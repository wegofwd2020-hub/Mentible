// Auto-sync controller (ADR-014 increment 1b). Wires the three event-driven
// triggers — sign-in, app-foreground, and local edits — into the existing
// `syncNow` (verbatim, no new merge/conflict logic here; LWW stays LWW) behind
// a single guarded, single-flight runner. There is deliberately NO polling
// timer: every run is caused by one of these three triggers.
//
// Guard order (all must hold or the trigger is a silent no-op):
//   toggle-on (AUTOSYNC_ENABLED_KEY, default true) AND !IS_DEMO AND
//   signed_in with a non-null access token AND unlocked (an LMK is cached).
//
// Silent on success (no Alert) and silent on failure (status -> "error", no
// Alert) — the next trigger retries. The sign-in/foreground triggers are
// throttled by MIN_INTERVAL_MS; the edit trigger is debounced by DEBOUNCE_MS
// instead (and is exempt from the min-interval so edits always eventually
// push, even right after a foreground sync).
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncNow, syncStatus, isUnlocked } from "@/sync/syncEngine";
import { subscribeBookStore } from "@/storage/bookStore";
import { useAuth } from "@/auth/AuthProvider";
import { IS_DEMO } from "@/constants/demo";
import { setSyncStatus } from "@/sync/syncStatusStore";

export const AUTOSYNC_ENABLED_KEY = "sbq_autosync_enabled";

// Absent (never toggled) is treated as ON — auto-sync is opt-out, not opt-in.
export async function isAutoSyncEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(AUTOSYNC_ENABLED_KEY);
  return raw !== "false";
}

export async function setAutoSyncEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTOSYNC_ENABLED_KEY, on ? "true" : "false");
}

const DEBOUNCE_MS = 4000;
const MIN_INTERVAL_MS = 15000;

type TriggerReason = "signin" | "foreground" | "edit";

// Module-level (not per-render) single-flight state. Only one `SyncController`
// is ever mounted (app root), but keeping this outside the hook makes the
// guard/runner a plain, directly-testable function rather than something tied
// to a particular component instance.
let running = false;
let rerunQueued = false;
let lastRunAt = 0;

async function runSync(token: string): Promise<void> {
  running = true;
  setSyncStatus({ state: "syncing" });
  try {
    await syncNow(token);
    const fresh = await syncStatus(token);
    setSyncStatus(fresh);
  } catch {
    // Silent — no Alert. The next trigger (sign-in/foreground/edit) retries.
    setSyncStatus({ state: "error" });
  } finally {
    lastRunAt = Date.now();
    running = false;
    if (rerunQueued) {
      rerunQueued = false;
      await runSync(token);
    }
  }
}

async function requestSync(reason: TriggerReason, token: string | null, signedIn: boolean): Promise<void> {
  // A run is already in flight — coalesce this trigger into a single rerun
  // once it finishes, rather than starting a second `syncNow`.
  if (running) {
    rerunQueued = true;
    return;
  }
  if (IS_DEMO) return;
  if (!signedIn || !token) return;
  if (!(await isAutoSyncEnabled())) return;
  if (!(await isUnlocked())) return;

  // Min-interval throttle applies only to the sign-in/foreground triggers —
  // the edit trigger is debounced instead, so it is exempt (edits must always
  // eventually push).
  if ((reason === "signin" || reason === "foreground") && Date.now() - lastRunAt < MIN_INTERVAL_MS) {
    return;
  }

  // Re-check after the async guard checks above, in case another trigger
  // started a run while we were awaiting them.
  if (running) {
    rerunQueued = true;
    return;
  }

  await runSync(token);
}

export function useAutoSync(): void {
  const { status, accessToken } = useAuth();

  // Refs so the AppState/bookStore listeners (subscribed once) always read
  // the latest auth state without needing to re-subscribe on every render.
  const statusRef = useRef(status);
  const tokenRef = useRef(accessToken);
  statusRef.current = status;
  tokenRef.current = accessToken;

  // Trigger (a): fires on mount if already signed in, and again on any
  // transition into "signed_in".
  useEffect(() => {
    if (status === "signed_in" && accessToken) {
      void requestSync("signin", accessToken, true);
    }
  }, [status, accessToken]);

  // Triggers (b) foreground and (c) debounced edit — subscribed once for the
  // lifetime of the controller.
  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void requestSync("foreground", tokenRef.current, statusRef.current === "signed_in");
      }
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeBookStore = subscribeBookStore(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void requestSync("edit", tokenRef.current, statusRef.current === "signed_in");
      }, DEBOUNCE_MS);
    });

    return () => {
      appStateSub.remove();
      unsubscribeBookStore();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);
}

// Mount this once near the app root (alongside AuthProvider) to keep devices
// converged without any screen having to know about sync.
export function SyncController(): null {
  useAutoSync();
  return null;
}
