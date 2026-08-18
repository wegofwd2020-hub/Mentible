import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ApiError, exportBook } from "@/api/client";
import { buildCompilePayload } from "@/lib/compilePayload";
import { trackedExport } from "@/lib/trackedExport";
import { downloadArtifact } from "@/storage/epubLibrary";
import { TrustBadge } from "@/components/TrustBadge";
import { Button, Label } from "@/components/ui";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import type { Book } from "@/types/book";
import type { TrustManifest } from "@/types/trust";

type State =
  | { kind: "idle" }
  | { kind: "working"; fmt: "epub" | "pdf" | "pack" }
  | { kind: "done"; msg: string; trust?: TrustManifest }
  | { kind: "error"; msg: string };

function slug(title: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "book";
}

// "Check out" a Library book in a chosen format. EPUB3 is the artifact already
// saved in the Library (instant download); PDF is compiled on demand by the
// backend (slower — minutes for a big book).
export function CheckoutButton({ book }: { book: Book }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<State>({ kind: "idle" });

  // Compile a fresh artifact WITH diagrams (Mermaid→SVG) and hand it to the
  // user — same for both formats, so the checked-out book always has its images.
  const checkout = async (fmt: "epub" | "pdf") => {
    setState({ kind: "working", fmt });
    try {
      const { artifact, trust } = await trackedExport(book, fmt, { diagrams: true });
      const mime = fmt === "pdf" ? "application/pdf" : "application/epub+zip";
      const res = await downloadArtifact(artifact, `${slug(book.title)}.${fmt}`, mime);
      const label = fmt.toUpperCase();
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : `${label} downloaded.`,
        // Book-level trust manifest (compliance + integrity over the compiled
        // artifact) — render the badge so the finished book carries its checks.
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  // KDP-clean export (docs/specs/kdp-clean-export-profile.md) — a distinct
  // action, not a checkbox on the existing export, since it produces a
  // DIFFERENT artifact (rasterized math/diagrams, JPEG cover, no embedded
  // body font). Bypasses trackedExport's exportStatus tracking (which is
  // keyed by format "epub"/"pdf"/"docx" — a concurrent plain-EPUB export
  // would collide with this one under the same "epub" key), same as the
  // cover thumbnail's raw exportBook call in SaveToLibraryButton.
  const checkoutKdp = async () => {
    setState({ kind: "working", fmt: "epub" });
    try {
      const payload = await buildCompilePayload(book);
      const { artifact, trust } = await exportBook(payload, {
        format: "epub",
        diagrams: true,
        profile: "kdp",
      });
      const res = await downloadArtifact(artifact, `${slug(book.title)}-kdp.epub`, "application/epub+zip");
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "KDP-clean EPUB downloaded.",
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  // Publish pack (P2-6 Scope B, docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md)
  // — a single zip bundling the KDP-clean EPUB, a raster cover, a metadata
  // sheet, and a retailer upload checklist. Same distinct-artifact pattern as
  // checkoutKdp: bypasses trackedExport's exportStatus tracking (keyed by
  // format "epub"/"pdf"/"docx" — a concurrent plain-EPUB export would collide
  // with this one under the same "epub" key).
  const checkoutPack = async () => {
    setState({ kind: "working", fmt: "pack" });
    try {
      const payload = await buildCompilePayload(book);
      const { artifact, trust } = await exportBook(payload, { format: "pack" });
      const res = await downloadArtifact(
        artifact,
        `${slug(book.title)}-publish-pack.zip`,
        "application/zip",
      );
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "Publish pack downloaded.",
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  const working = state.kind === "working";

  return (
    <View style={styles.root}>
      <Label tone="secondary">Check out</Label>
      <View style={styles.row}>
        <Button
          variant="ghost"
          label="EPUB3"
          onPress={() => checkout("epub")}
          disabled={working}
          accessibilityLabel="Check out as EPUB3"
          style={styles.btn}
        />
        <Button
          variant="ghost"
          label="PDF"
          onPress={() => checkout("pdf")}
          disabled={working}
          accessibilityLabel="Check out as PDF"
          style={styles.btn}
        />
        <Button
          variant="ghost"
          label="Kindle (KDP)"
          onPress={checkoutKdp}
          disabled={working}
          accessibilityLabel="Export a KDP-clean EPUB for Kindle"
          style={styles.btn}
        />
        <Button
          variant="ghost"
          label="Publish pack"
          onPress={checkoutPack}
          disabled={working}
          accessibilityLabel="Download a publish pack for retailers"
          style={styles.btn}
        />
      </View>

      {working && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.primary} />
          <Text style={styles.statusText}>
            Rendering diagrams + building the {state.fmt.toUpperCase()} — this can take a
            few minutes for a large book.
          </Text>
        </View>
      )}
      {state.kind === "done" && (
        <View style={styles.doneBlock}>
          <Text style={styles.doneText}>✓ {state.msg}</Text>
          {state.trust && <TrustBadge manifest={state.trust} />}
        </View>
      )}
      {state.kind === "error" && <Text style={styles.errText}>{state.msg}</Text>}
    </View>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return err.userMessage();
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

const makeStyles = (c: Palette) => ({
  root: { gap: spacing.xs, marginTop: spacing.lg },
  row: { flexDirection: "row" as const, gap: spacing.sm },
  btn: { flex: 1 },
  statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, marginTop: spacing.xs },
  statusText: { color: c.textSecondary, fontSize: typography.sizeSm },
  doneBlock: { gap: spacing.sm, marginTop: spacing.xs },
  doneText: { color: c.success, fontSize: typography.sizeSm },
  errText: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.xs },
});
