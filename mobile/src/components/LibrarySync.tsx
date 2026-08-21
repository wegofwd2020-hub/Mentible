// Settings "Library sync" section (zk-library-sync-increment1, Task 4). Drives
// the zero-knowledge sync engine (`@/sync/syncEngine`): enable sync on this
// account (generates + shows the recovery key EXACTLY ONCE), unlock sync on a
// new device with that recovery key, and run a manual "Sync now". The
// recovery key is the ONLY way to unlock a second device, so it is shown once
// at enable-time and never re-rendered anywhere else — losing it means the
// exported EPUB/PDF is the documented fallback (ADR-014 O4).
//
// Requires a signed-in user (the engine calls the backend with a Bearer
// token) — the caller (Settings) mounts this behind RequireSignIn + !IS_DEMO.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Switch, Text, TextInput, View } from "react-native";
import {
  isUnlocked,
  enableSync,
  unlockOnDevice,
  syncNow,
  syncStatus,
  getLastSyncedAt,
  SyncLockedError,
  SyncKeysetExistsError,
  type SyncStatus,
} from "@/sync/syncEngine";
import { isAutoSyncEnabled, setAutoSyncEnabled } from "@/sync/autoSync";
import { useSyncStatus, setSyncStatus } from "@/sync/syncStatusStore";
import { copyText } from "@/lib/clipboard";
import { Alert } from "@/lib/alert";
import { Button, Label } from "@/components/ui";
import { spacing, radius, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";

// Maps a live `SyncStatus` (from the auto-sync controller or a fresh
// `syncStatus()` poll) to the one-line badge copy shown under "Last synced".
// `signed_out` renders nothing here — this panel only mounts when signed in
// (RequireSignIn + !IS_DEMO), so hitting it would mean the token just dropped
// mid-session; better to show nothing than a stale/wrong line. `locked` is
// defensive: the "unlocked" phase branch that renders this shouldn't be
// reachable while the engine considers sync locked, but if the two ever
// disagree we point at the same unlock affordance rather than showing a
// confusing status.
function syncStatusCopy(status: SyncStatus): string | null {
  switch (status.state) {
    case "up_to_date":
      return "Up to date ✓";
    case "pending": {
      const n = status.toPush + status.toPull;
      return `${n} change${n === 1 ? "" : "s"} to sync`;
    }
    case "syncing":
      return "Syncing…";
    case "error":
      return "Couldn't sync — will retry";
    case "locked":
      return "Unlock this device to sync";
    case "signed_out":
      return null;
    default:
      return null;
  }
}

// "checking" = resolving isUnlocked() on mount.
// "locked" = no LMK cached on this device (never enabled here, or a new
//   device that hasn't unlocked yet) — shows Enable + an Unlock affordance.
// "enable-setup" = enableSync() just returned a fresh recovery key; shown
//   exactly once until the user confirms they saved it.
// "unlocked" = an LMK is cached on this device — Sync now is available.
type Phase = "checking" | "locked" | "enable-setup" | "unlocked";

export function LibrarySync(): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const { accessToken: token } = useAuth();
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [showUnlockForm, setShowUnlockForm] = useState(false);
  const [unlockKey, setUnlockKey] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Auto-sync opt-out toggle (default reflects `isAutoSyncEnabled()`'s own
  // opt-out default of `true`) and the live status badge, sourced from the
  // shared pub/sub store the auto-sync controller writes to.
  const [autoSyncOn, setAutoSyncOn] = useState(true);
  const status = useSyncStatus();

  useEffect(() => {
    let active = true;
    (async () => {
      const unlocked = await isUnlocked();
      if (!active) return;
      if (unlocked) {
        setLastSyncedAt(await getLastSyncedAt());
        if (active) setPhase("unlocked");
      } else {
        setPhase("locked");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Seed the toggle from persisted state once on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      const on = await isAutoSyncEnabled();
      if (active) setAutoSyncOn(on);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Refresh the status badge as soon as the panel becomes usable — a cheap,
  // read-only poll (see `syncStatus`'s own doc comment), never a full sync.
  useEffect(() => {
    if (phase !== "unlocked") return;
    let active = true;
    (async () => {
      const fresh = await syncStatus(token);
      if (active) setSyncStatus(fresh);
    })();
    return () => {
      active = false;
    };
  }, [phase, token]);

  async function onToggleAutoSync(next: boolean) {
    setAutoSyncOn(next);
    await setAutoSyncEnabled(next);
  }

  async function runSync() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await syncNow(token);
      setLastSyncedAt(await getLastSyncedAt());
      setSyncStatus(await syncStatus(token));
      const extra = r.failed.length ? ` ${r.failed.length} book(s) couldn't sync.` : "";
      Alert.alert("Sync complete", `Pushed ${r.pushed}, pulled ${r.pulled}, removed ${r.deleted}.${extra}`);
    } catch (e) {
      if (e instanceof SyncLockedError) {
        setPhase("locked");
        setShowUnlockForm(true);
      } else {
        Alert.alert("Sync failed", e instanceof Error ? e.message : "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onEnable() {
    if (!token) return;
    setBusy(true);
    try {
      const key = await enableSync(token);
      setRecoveryKey(key);
      setPhase("enable-setup");
    } catch (e) {
      if (e instanceof SyncKeysetExistsError) {
        // Someone else already turned sync on for this account — route to
        // unlock instead of silently overwriting their keyset.
        setShowUnlockForm(true);
      } else {
        Alert.alert("Couldn't enable sync", e instanceof Error ? e.message : "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  // Dismiss the one-time recovery-key display and kick off the first sync.
  async function onConfirmSaved() {
    setRecoveryKey(null);
    setPhase("unlocked");
    await runSync();
  }

  async function onCopy() {
    if (!recoveryKey) return;
    await copyText(recoveryKey);
  }

  async function onUnlock() {
    if (!token || !unlockKey.trim()) return;
    setBusy(true);
    try {
      await unlockOnDevice(token, unlockKey.trim());
      setUnlockKey("");
      setShowUnlockForm(false);
      setPhase("unlocked");
      await runSync();
    } catch {
      Alert.alert("That recovery key didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "checking") return null;

  return (
    <View style={styles.wrap}>
      <Label tone="secondary">Library sync</Label>

      {phase === "enable-setup" && recoveryKey && (
        <View style={styles.keyBox}>
          <Text style={styles.keyBoxTitle}>Your recovery key</Text>
          <Text selectable style={styles.keyText}>
            {recoveryKey}
          </Text>
          <Button variant="ghost" label="Copy" onPress={onCopy} style={styles.btn} />
          <Text style={styles.warning}>
            This is the ONLY way to unlock sync on a new device. We can&apos;t recover it. Your
            exported EPUB/PDF is your fallback.
          </Text>
          <Button
            variant="primary"
            label="I've saved it — continue"
            onPress={onConfirmSaved}
            busy={busy}
            disabled={busy}
          />
        </View>
      )}

      {phase === "locked" && (
        <>
          <Button
            variant="primary"
            label="Enable cloud sync"
            onPress={onEnable}
            busy={busy}
            disabled={busy || !token}
            style={styles.btn}
          />
          {!showUnlockForm && (
            <Text
              style={styles.link}
              onPress={() => setShowUnlockForm(true)}
              accessibilityRole="button"
              accessibilityLabel="Unlock sync on this device"
            >
              Already syncing on another device? Unlock this device
            </Text>
          )}
          {showUnlockForm && (
            <View style={styles.unlockRow}>
              <Label tone="muted">Recovery key</Label>
              <TextInput
                style={styles.input}
                placeholder="Paste your recovery key"
                placeholderTextColor={styles.note.color}
                value={unlockKey}
                onChangeText={setUnlockKey}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Recovery key"
              />
              <Button
                variant="ghost"
                label="Unlock"
                onPress={onUnlock}
                busy={busy}
                disabled={busy || !token || !unlockKey.trim()}
                style={styles.btn}
              />
            </View>
          )}
        </>
      )}

      {phase === "unlocked" && (
        <>
          <Text style={styles.note}>
            {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : "Not synced yet"}
          </Text>
          {syncStatusCopy(status) && (
            <View style={styles.statusRow}>
              {status.state === "syncing" && (
                <ActivityIndicator size="small" color={styles.statusText.color} />
              )}
              <Text style={styles.statusText}>{syncStatusCopy(status)}</Text>
            </View>
          )}
          <View style={styles.toggleRow}>
            <Label tone="muted">Auto-sync</Label>
            <Switch
              value={autoSyncOn}
              onValueChange={onToggleAutoSync}
              accessibilityLabel="Auto-sync"
            />
          </View>
          <Button
            variant="ghost"
            label="Sync now"
            onPress={runSync}
            busy={busy}
            disabled={busy || !token}
            style={styles.btn}
          />
        </>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { gap: spacing.sm },
  btn: { flexGrow: 1 as const },
  keyBox: {
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  keyBoxTitle: { color: c.text, fontWeight: "700" as const, fontSize: typography.sizeMd },
  keyText: {
    color: c.text,
    fontFamily: typography.fontMono,
    fontSize: typography.sizeMd,
    padding: spacing.sm,
    backgroundColor: c.background,
    borderRadius: radius.sm,
  },
  warning: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const, lineHeight: 18 },
  link: { color: c.primary, fontSize: typography.sizeSm, textDecorationLine: "underline" as const },
  unlockRow: { gap: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    color: c.text,
  },
  note: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const },
  statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  statusText: { color: c.textMuted, fontSize: typography.sizeXs },
  toggleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
});
