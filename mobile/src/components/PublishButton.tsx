import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ApiError, publishBook } from "@/api/client";
import { loadBook } from "@/storage/bookStore";
import { useAuth } from "@/auth/AuthProvider";
import { demoBlocked } from "@/constants/demo";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

type State =
  | { kind: "idle" }
  | { kind: "publishing"; fmt: "epub" | "pdf" }
  | { kind: "done" }
  | { kind: "error"; message: string };

// Publish a book's EPUB + PDF to the Open Library (ADR-027): compiles them
// server-side and hosts them so any reader can see the green indicators and
// download. Distinct from "Save to Library" (which keeps a private on-device
// EPUB). Requires a signed-in author.
export function PublishButton({ bookId }: { bookId: string }) {
  const { accessToken } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<State>({ kind: "idle" });

  if (!accessToken) return null; // publishing is author-only (needs a session)

  const publish = async () => {
    if (demoBlocked()) return;
    try {
      const book = await loadBook(bookId);
      if (!book) throw new Error("Book not found.");
      for (const fmt of ["epub", "pdf"] as const) {
        setState({ kind: "publishing", fmt });
        const job = await publishBook(book, fmt, accessToken);
        if (job.status === "failed") {
          throw new Error(job.error || `Could not publish the ${fmt.toUpperCase()}.`);
        }
      }
      setState({ kind: "done" });
    } catch (err) {
      setState({ kind: "error", message: messageFor(err) });
    }
  };

  if (state.kind === "done") {
    return (
      <View style={styles.doneBox}>
        <Text style={styles.doneText}>✓ Published to the Library — readers can now download it.</Text>
      </View>
    );
  }

  const publishing = state.kind === "publishing";
  return (
    <View>
      <Pressable
        style={[styles.btn, publishing && styles.btnDisabled]}
        onPress={publish}
        disabled={publishing}
        accessibilityRole="button"
        accessibilityLabel="Publish book to the Open Library"
        accessibilityState={{ disabled: publishing }}
      >
        {publishing ? (
          <View style={styles.row}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.btnText}> Publishing {state.fmt.toUpperCase()}… (can take a few minutes)</Text>
          </View>
        ) : (
          <Text style={styles.btnText}>Publish to Library (EPUB + PDF)</Text>
        )}
      </Pressable>
      {state.kind === "error" && <Text style={styles.errText}>{state.message}</Text>}
    </View>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return err.userMessage();
    if (err.status === 401 || err.status === 403) return "Sign in to publish this book.";
    if (err.status === 422) {
      try {
        const detail = JSON.parse(err.body)?.detail;
        if (typeof detail === "string") return detail;
      } catch {
        /* fall through */
      }
      return "This book has no generated content yet — generate its topics first.";
    }
    if (err.status === 503) return "The Library isn’t available right now.";
    return `Publish failed (server error ${err.status}).`;
  }
  if (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message)) {
    return "Couldn’t reach the server. Is the backend running?";
  }
  return err instanceof Error ? err.message : "Couldn’t publish.";
}

const makeStyles = (c: Palette) => ({
  btn: {
    backgroundColor: c.surfaceHigh,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.sm,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  row: { flexDirection: "row" as const, alignItems: "center" as const },
  errText: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  doneBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.success + "1A",
    borderColor: c.success + "66",
    borderWidth: 1,
    alignItems: "center" as const,
  },
  doneText: { color: c.success, fontSize: typography.sizeSm, fontWeight: "700" as const, textAlign: "center" as const },
});
