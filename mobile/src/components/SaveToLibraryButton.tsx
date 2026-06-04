import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, exportBook } from "@/api/client";
import { saveEpub } from "@/storage/epubLibrary";
import { loadBook } from "@/storage/bookStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

// Compiles the saved book to an EPUB3 (backend /export) and stores it in the
// device Library, then offers a jump to the Library tab. Reloads the book from
// the store at press time so it compiles the latest *saved* state.
// Diagrams are rendered (Mermaid → SVG) so the shelved artifact matches what the
// reader sees — this makes the compile minutes-long for diagram-heavy books.
export function SaveToLibraryButton({ bookId }: { bookId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const save = async () => {
    setState({ kind: "saving" });
    try {
      const book = await loadBook(bookId);
      if (!book) throw new Error("Book not found.");
      const bytes = await exportBook(book, { diagrams: true });
      // Cover thumbnail is best-effort — never fail the save over it.
      let coverBytes: ArrayBuffer | undefined;
      try {
        coverBytes = await exportBook(book, { format: "cover" });
      } catch {
        coverBytes = undefined;
      }
      await saveEpub({ bookId: book.id, title: book.title, bytes, coverBytes });
      setState({ kind: "done" });
    } catch (err) {
      setState({ kind: "error", message: messageFor(err) });
    }
  };

  if (state.kind === "done") {
    return (
      <View style={styles.doneBox}>
        <Text style={styles.doneText}>✓ Saved to your Library as EPUB3.</Text>
        <Pressable
          onPress={() => router.push("/library")}
          accessibilityRole="button"
          accessibilityLabel="Open Library"
        >
          <Text style={styles.link}>Open Library →</Text>
        </Pressable>
      </View>
    );
  }

  const saving = state.kind === "saving";
  return (
    <View>
      <Pressable
        style={[styles.btn, saving && styles.btnDisabled]}
        onPress={save}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Save book to library as EPUB"
        accessibilityState={{ disabled: saving }}
      >
        {saving ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primaryText} />
            <Text style={styles.btnText}> Rendering diagrams + compiling EPUB…</Text>
          </View>
        ) : (
          <Text style={styles.btnText}>Save to Library (EPUB3)</Text>
        )}
      </Pressable>
      {state.kind === "error" && <Text style={styles.errText}>{state.message}</Text>}
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
        /* fall through */
      }
      return "This book has no generated content yet — generate its topics first.";
    }
    return `Export failed (server error ${err.status}).`;
  }
  if (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message)) {
    return "Couldn’t reach the server. Is the backend running?";
  }
  return err instanceof Error ? err.message : "Couldn’t save to library.";
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center" },
  errText: { color: colors.error, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  doneBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.success + "1A",
    borderColor: colors.success + "66",
    borderWidth: 1,
    alignItems: "center",
    gap: spacing.xs,
  },
  doneText: { color: colors.success, fontSize: typography.sizeMd, fontWeight: "700" },
  link: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "600" },
});
