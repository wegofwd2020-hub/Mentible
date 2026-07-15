import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { downloadArtifact, downloadTextArtifact } from "@/storage/epubLibrary";
import { exportBookBundle } from "@/storage/bookBundle";
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

function hasAnyImages(book: Book): boolean {
  return Object.values(book.content ?? {}).some((gen) => (gen.images?.length ?? 0) > 0);
}

// Export the in-app Book object as a .book.json file — the same shape the
// "Import a book" flow ingests. Lets the user back up / move / share an
// authored book before (or instead of) compiling it to EPUB3/PDF. A book with
// attached images can't round-trip as plain JSON (image bytes live on-device,
// off the JSON — see mediaStore.ts), so those export as a `.book.zip` bundle
// (book.json + media/…, see bookBundle.ts) instead; an image-less book keeps
// the plain JSON path.
export function ExportBookJsonButton({ book }: { book: Book }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const exportBook = async () => {
    setState({ kind: "working" });
    try {
      let res: { savedPath?: string };
      if (hasAnyImages(book)) {
        const zip = await exportBookBundle(book);
        // Slice to a fresh, zero-offset buffer — a Uint8Array's `.buffer` isn't
        // guaranteed to start at byte 0 of its underlying ArrayBuffer.
        res = await downloadArtifact(zip.slice().buffer, `${slug(book.title)}.book.zip`, "application/zip");
      } else {
        const json = JSON.stringify(book, null, 2);
        res = await downloadTextArtifact(json, `${slug(book.title)}.book.json`, "application/json");
      }
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "Download started.",
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
        onPress={exportBook}
        disabled={working}
        accessibilityRole="button"
        accessibilityLabel="Export this book"
        accessibilityState={{ disabled: working }}
      >
        <Text style={styles.btnText}>{working ? "Exporting…" : "Export book"}</Text>
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
