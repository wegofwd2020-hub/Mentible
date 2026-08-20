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
import { Text, TextInput, View } from "react-native";
import {
  isUnlocked,
  enableSync,
  unlockOnDevice,
  syncNow,
  getLastSyncedAt,
  SyncLockedError,
  SyncKeysetExistsError,
} from "@/sync/syncEngine";
import { copyText } from "@/lib/clipboard";
import { Alert } from "@/lib/alert";
import { Button, Label } from "@/components/ui";
import { spacing, radius, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";

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

  async function runSync() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await syncNow(token);
      setLastSyncedAt(await getLastSyncedAt());
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
});
