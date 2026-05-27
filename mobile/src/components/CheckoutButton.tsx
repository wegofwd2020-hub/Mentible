import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, exportBook } from "@/api/client";
import { downloadArtifact, openEpub } from "@/storage/epubLibrary";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";

type State =
  | { kind: "idle" }
  | { kind: "working"; fmt: "epub" | "pdf" }
  | { kind: "done"; msg: string }
  | { kind: "error"; msg: string };

function slug(title: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "book";
}

// "Check out" a Library book in a chosen format. EPUB3 is the artifact already
// saved in the Library (instant download); PDF is compiled on demand by the
// backend (slower — minutes for a big book).
export function CheckoutButton({ book }: { book: Book }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const checkoutEpub = async () => {
    setState({ kind: "working", fmt: "epub" });
    try {
      await openEpub(book.id, book.title); // the stored Library EPUB
      setState({ kind: "done", msg: Platform.OS === "web" ? "EPUB downloaded." : "EPUB ready." });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  const checkoutPdf = async () => {
    setState({ kind: "working", fmt: "pdf" });
    try {
      const bytes = await exportBook(book, { format: "pdf" });
      const res = await downloadArtifact(bytes, `${slug(book.title)}.pdf`, "application/pdf");
      setState({ kind: "done", msg: res.savedPath ? `Saved: ${res.savedPath}` : "PDF downloaded." });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  const working = state.kind === "working";

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Check out</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, working && styles.btnDisabled]}
          onPress={checkoutEpub}
          disabled={working}
          accessibilityRole="button"
          accessibilityLabel="Check out as EPUB3"
        >
          <Text style={styles.btnText}>EPUB3</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnAlt, working && styles.btnDisabled]}
          onPress={checkoutPdf}
          disabled={working}
          accessibilityRole="button"
          accessibilityLabel="Check out as PDF"
        >
          <Text style={[styles.btnText, styles.btnAltText]}>PDF</Text>
        </Pressable>
      </View>

      {working && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>
            {state.fmt === "pdf" ? "Compiling PDF… this can take a minute." : "Preparing EPUB…"}
          </Text>
        </View>
      )}
      {state.kind === "done" && <Text style={styles.doneText}>✓ {state.msg}</Text>}
      {state.kind === "error" && <Text style={styles.errText}>{state.msg}</Text>}
    </View>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 422) {
      try {
        const detail = JSON.parse(err.body)?.detail;
        if (typeof detail === "string") return detail;
      } catch {
        /* ignore */
      }
      return "This book has no generated content to export.";
    }
    return `Export failed (server error ${err.status}).`;
  }
  if (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message)) {
    return "Couldn’t reach the server. Is the backend running?";
  }
  return err instanceof Error ? err.message : "Checkout failed.";
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, marginTop: spacing.lg },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  btnAlt: { backgroundColor: colors.surfaceHigh, borderColor: colors.primary, borderWidth: 1 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  btnAltText: { color: colors.primary },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  statusText: { color: colors.textSecondary, fontSize: typography.sizeSm },
  doneText: { color: colors.success, fontSize: typography.sizeSm, marginTop: spacing.xs },
  errText: { color: colors.error, fontSize: typography.sizeSm, marginTop: spacing.xs },
});
