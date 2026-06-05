import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { downloadTextArtifact } from "@/storage/epubLibrary";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; msg: string }
  | { kind: "error"; msg: string };

function slug(title: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "book";
}

// Export the in-app Book object as a .book.json file — the same shape the
// "Import a book" flow ingests. Lets the user back up / move / share an
// authored book before (or instead of) compiling it to EPUB3/PDF.
export function ExportBookJsonButton({ book }: { book: Book }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const exportJson = async () => {
    setState({ kind: "working" });
    try {
      const json = JSON.stringify(book, null, 2);
      const res = await downloadTextArtifact(json, `${slug(book.title)}.book.json`, "application/json");
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "JSON downloaded.",
      });
    } catch (err) {
      setState({ kind: "error", msg: err instanceof Error ? err.message : "Export failed." });
    }
  };

  const working = state.kind === "working";

  return (
    <View style={styles.root}>
      <Pressable
        style={[styles.btn, working && styles.btnDisabled]}
        onPress={exportJson}
        disabled={working}
        accessibilityRole="button"
        accessibilityLabel="Export this book as JSON"
        accessibilityState={{ disabled: working }}
      >
        <Text style={styles.btnText}>{working ? "Exporting…" : "Export book as JSON"}</Text>
      </Pressable>
      {state.kind === "done" && <Text style={styles.doneText}>✓ {state.msg}</Text>}
      {state.kind === "error" && <Text style={styles.errText}>{state.msg}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, marginTop: spacing.md },
  btn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" },
  doneText: { color: colors.success, fontSize: typography.sizeSm },
  errText: { color: colors.error, fontSize: typography.sizeSm },
});
