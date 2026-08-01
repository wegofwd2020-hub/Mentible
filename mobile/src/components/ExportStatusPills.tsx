import React, { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import {
  deriveState,
  type BookExportStatus,
  type ExportFormat,
  type ExportUiState,
} from "@/storage/exportStatus";
import type { PublishedFormats } from "@/lib/trackedExport";

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

const makeStateStyle = (c: Palette): Record<ExportUiState, { dot: string; label: string }> => ({
  none: { dot: c.textMuted, label: "not exported" },
  generating: { dot: c.primary, label: "generating" },
  done: { dot: c.success, label: "up to date" },
  stale: { dot: c.warning, label: "needs re-export" },
  failed: { dot: c.error, label: "failed" },
});

function Pill({ fmt, state, stateStyle, styles, theme }: { fmt: ExportFormat; state: ExportUiState; stateStyle: Record<ExportUiState, { dot: string; label: string }>; styles: ReturnType<typeof makeStyles>; theme: Palette }) {
  const s = stateStyle[state];
  const name = fmt.toUpperCase();
  return (
    <View
      style={styles.pill}
      accessibilityRole="text"
      accessibilityLabel={`${name}: ${s.label}`}
    >
      {state === "generating" ? (
        <ActivityIndicator size="small" color={theme.primary} style={styles.spinner} />
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
  published?: PublishedFormats;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const stateStyle = useMemo(() => makeStateStyle(theme), [theme]);
  return (
    <View style={styles.row}>
      <Pill fmt="epub" state={foldPublished(deriveState(status?.epub, bookUpdatedAt), published?.epub)} stateStyle={stateStyle} styles={styles} theme={theme} />
      <Pill fmt="pdf" state={foldPublished(deriveState(status?.pdf, bookUpdatedAt), published?.pdf)} stateStyle={stateStyle} styles={styles} theme={theme} />
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  row: { flexDirection: "row" as const, gap: spacing.xs, alignItems: "center" as const },
  pill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: c.surfaceHigh,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  spinner: { width: 8, height: 8, transform: [{ scale: 0.6 }] },
  pillText: {
    fontSize: typography.sizeXs,
    fontWeight: "700" as const,
    color: c.textSecondary,
    letterSpacing: 0.3,
  },
});
