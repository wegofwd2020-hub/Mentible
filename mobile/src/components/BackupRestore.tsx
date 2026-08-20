// Settings "Backup & Restore" section (backup-restore plan, Task 4). Export
// zips the local library — books, saved EPUBs, shelves, and a few settings
// (never the BYOK key — see SETTINGS_KEYS in backupRestore.ts) — and hands it
// to the user via saveBackupFile (web download / native documentDirectory
// write). Restore is destructive (it overwrites any book/EPUB with the same
// id), so it always runs behind a confirm Alert before restoreBackup() ever
// touches storage.

import React, { useState } from "react";
import { View, Text } from "react-native";
import { buildBackup, restoreBackup } from "@/storage/backupRestore";
import { saveBackupFile, pickBackupFile } from "@/lib/backupFile";
import { Alert } from "@/lib/alert";
import { Button, Label } from "@/components/ui";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

export function BackupRestore(): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    try {
      const b = await buildBackup();
      await saveBackupFile(b.bytes, b.filename);
      Alert.alert("Backup saved", `${b.counts.books} book(s) + ${b.counts.epubs} EPUB(s).`);
    } catch (e) {
      Alert.alert("Couldn't create backup", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    setBusy(true);
    try {
      const bytes = await pickBackupFile();
      if (!bytes) return;
      Alert.alert(
        "Restore?",
        "This overwrites any book/EPUB with the same id.",
        [
          { text: "Cancel" },
          {
            text: "Import",
            onPress: async () => {
              setBusy(true);
              try {
                const r = await restoreBackup(bytes);
                Alert.alert(
                  "Restored",
                  `${r.books} book(s), ${r.epubs} EPUB(s)` +
                    `${r.overwritten ? `, ${r.overwritten} overwritten` : ""}.` +
                    `${r.warnings.length ? ` ${r.warnings.length} skipped.` : ""} Reload to see them.`,
                );
              } catch (e) {
                Alert.alert("Couldn't restore", e instanceof Error ? e.message : "Not a valid backup.");
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Label tone="secondary">Backup & Restore</Label>
      <View style={styles.row}>
        <Button
          variant="ghost"
          label="Export library"
          onPress={onExport}
          busy={busy}
          disabled={busy}
          style={styles.btn}
        />
        <Button
          variant="ghost"
          label="Restore from backup"
          onPress={onRestore}
          busy={busy}
          disabled={busy}
          style={styles.btn}
        />
      </View>
      <Text style={styles.note}>
        Backs up your books, saved EPUBs, shelves, and settings — not your API key.
        Restore overwrites items with the same id.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  btn: { flexGrow: 1 as const },
  note: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const, lineHeight: 18 },
});
