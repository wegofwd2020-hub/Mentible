// Auto-sync controller (ADR-014 increment 1b). Wires the three event-driven
// triggers — sign-in, app-foreground, and local edits — into the existing
// `syncNow` (verbatim, no new merge/conflict logic here; LWW stays LWW)
// behind a single guarded, single-flight runner. There is deliberately NO
// polling timer: every run is caused by one of these three triggers.
//
// Guard order (all must hold or the run is skipped, silently):
//   toggle-on (AUTOSYNC_ENABLED_KEY, default true) AND !IS_DEMO AND
//   signed_in with a non-null access token AND unlocked (an LMK is cached).
//
// Silent on success (no Alert) and silent on failure (status -> "error", no
// Alert) — the next trigger retries. The sign-in/foreground triggers are
// throttled by MIN_INTERVAL_MS; the edit trigger is debounced by DEBOUNCE_MS
// instead (and is exempt from the min-interval so edits always eventually
// push, even right after a foreground sync).
//
// Single-flight structure: a synchronous "wanted" flag drained by a `pump()`
// loop, NOT an async guard-check-then-set-lock pattern. The lock
// (`if (running) return; running = true;`) has no `await` between the read
// and the write, so two triggers arriving back-to-back (e.g. the sign-in
// effect firing at the same moment as an AppState "active" event on cold
// start) can never both acquire it — JS's single-threaded execution makes
// that pair atomic. The loser only sets `wanted = true`; the winner's while
// loop re-checks `wanted` (and re-runs ALL guards, with the CURRENT
// token/status) after its own `syncNow` settles, so a coalesced rerun can
// never use a stale token or skip a guard that flipped false mid-run.
import { useEffect } from "react";
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

interface AuthSnapshot {
  status: string;
  accessToken: string | null;
}

// Module-level (not per-hook-instance) — only one `SyncController` is ever
// mounted, and keeping the lock/queue here (rather than in a component ref)
// makes the guarded runner a plain, directly-testable pair of functions.
let running = false;
let wanted = false;
let lastRunAt = 0;

// Updated every render by `useAutoSync` so `pump()`'s drain loop always
// re-guards against the LATEST auth snapshot, never a stale closure over the
// token/status captured when a listener was first registered.
const authRef: { current: AuthSnapshot } = { current: { status: "signed_out", accessToken: null } };

// Test-only: this module is a singleton, so its lock/queue/throttle state
// persists across `it()`s in the same file unless a test resets it.
export function __resetAutoSyncForTests(): void {
  running = false;
  wanted = false;
  lastRunAt = 0;
  authRef.current = { status: "signed_out", accessToken: null };
}

// The single-flight drain loop. Never rejects (every await is inside a
// try/catch), so `void pump()` at every call site is safe — no unhandled
// rejection even if a guard check (Keystore/AsyncStorage) throws.
async function pump(): Promise<void> {
  if (running) return; // synchronous check-and-set below — no `await` in between
  running = true;
  try {
    while (wanted) {
      wanted = false; // consume the request; a trigger during this run re-sets it -> loop again
      let ok = false;
      try {
        ok =
          (await isAutoSyncEnabled()) &&
          !IS_DEMO &&
          authRef.current.status === "signed_in" &&
          !!authRef.current.accessToken &&
          (await isUnlocked());
      } catch {
        ok = false; // a guard check itself threw — skip this run silently, no unhandled rejection
      }
      if (!ok) continue; // loop re-checks `wanted` — a fresh trigger can still run once guards pass again

      const token = authRef.current.accessToken as string; // re-read fresh every iteration
      setSyncStatus({ state: "syncing" });
      try {
        await syncNow(token);
        const fresh = await syncStatus(token);
        setSyncStatus(fresh);
        lastRunAt = Date.now();
      } catch {
        setSyncStatus({ state: "error" }); // silent — no Alert, no rethrow. Next trigger retries.
      }
    }
  } finally {
    running = false;
  }
}

function requestSync(reason: TriggerReason): void {
  // Min-interval throttle applies only to the sign-in/foreground triggers —
  // the edit trigger is debounced instead, so it is exempt (edits must
  // always eventually push).
  if ((reason === "signin" || reason === "foreground") && Date.now() - lastRunAt < MIN_INTERVAL_MS) {
    return;
  }
  wanted = true;
  void pump();
}

export function useAutoSync(): void {
  const { status, accessToken } = useAuth();

  // Trigger (a): fires on mount if already signed in, and again on any
  // transition into "signed_in". Also keeps `authRef` current every time
  // auth state changes (the effect below only registers listeners once).
  useEffect(() => {
    authRef.current = { status, accessToken };
    if (status === "signed_in" && accessToken) {
      requestSync("signin");
    }
  }, [status, accessToken]);

  // Triggers (b) foreground and (c) debounced edit — subscribed once for the
  // lifetime of the controller.
  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        requestSync("foreground");
      }
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeBookStore = subscribeBookStore(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        requestSync("edit");
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
