import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import {
  deriveState,
  type BookExportStatus,
  type ExportFormat,
  type ExportUiState,
} from "@/storage/exportStatus";

// Per-book EPUB/PDF availability indicators. Pure/presentational: the list owns
// the fetched status index and passes each book's slice + its live updatedAt, so
// rendering a shelf doesn't hit storage per tile.
//
// Colour = availability, five states:
//   none  grey    · not exported
//   done  green   · exported and current
//   stale amber   · exported, but the book changed since (re-export)
//   fail  red     · last export failed
//   gen   blue+spinner · a compile is running

const STATE_STYLE: Record<ExportUiState, { dot: string; label: string }> = {
  none: { dot: colors.textMuted, label: "not exported" },
  generating: { dot: colors.primary, label: "generating" },
  done: { dot: colors.success, label: "up to date" },
  stale: { dot: colors.warning, label: "needs re-export" },
  failed: { dot: colors.error, label: "failed" },
};

function Pill({ fmt, state }: { fmt: ExportFormat; state: ExportUiState }) {
  const s = STATE_STYLE[state];
  const name = fmt.toUpperCase();
  return (
    <View
      style={styles.pill}
      accessibilityRole="text"
      accessibilityLabel={`${name}: ${s.label}`}
    >
      {state === "generating" ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
      ) : (
        <View style={[styles.dot, { backgroundColor: s.dot }]} />
      )}
      <Text style={styles.pillText}>{name}</Text>
    </View>
  );
}

// A format with no local record but published to the Open Library reads as
// available (green) — this is what a reader (who never exported it locally) sees.
function foldPublished(local: ExportUiState, published: boolean | undefined): ExportUiState {
  return local === "none" && published ? "done" : local;
}

export function ExportStatusPills({
  status,
  bookUpdatedAt,
  published,
}: {
  status: BookExportStatus | undefined;
  bookUpdatedAt?: string;
  // Which formats are published to the Open Library (reader-visible availability).
  published?: { epub?: boolean; pdf?: boolean };
}) {
  return (
    <View style={styles.row}>
      <Pill fmt="epub" state={foldPublished(deriveState(status?.epub, bookUpdatedAt), published?.epub)} />
      <Pill fmt="pdf" state={foldPublished(deriveState(status?.pdf, bookUpdatedAt), published?.pdf)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  spinner: { width: 8, height: 8, transform: [{ scale: 0.6 }] },
  pillText: {
    fontSize: typography.sizeXs,
    fontWeight: "700",
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
});
