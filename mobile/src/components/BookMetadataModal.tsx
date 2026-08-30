import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import type { Book } from "@/types/book";
import { Ionicons } from "@expo/vector-icons";
import { ExportStatusPills } from "@/components/ExportStatusPills";
import type { BookExportStatus } from "@/storage/exportStatus";
import type { PublishedFormats } from "@/lib/trackedExport";

// Shown when a user taps a book on the Library shelf: a read-only window of the
// book's metadata, with a Read button that enters the reader. Fields that aren't
// present on a given book (e.g. an imported EPUB with no generation params, or a
// book with no editorial review yet) render as a muted placeholder rather than
// being hidden — so the window's shape is stable across books.

const DASH = "—";
const NOT_REVIEWED = "Not reviewed";

// Lightweight fallback metadata for books with no in-app Book record (imported
// EPUBs): just the title and the EPUB's compile date.
export interface BookMetaFallback {
  title: string;
  compiledAt?: string;
}

export interface BookMetadataRows {
  name: string;
  released: string;
  model: string;
  level: string;
  depth: string;
  diagrams: string;
  pages: string;
  reviewedBy: string;
  reviewedOn: string;
  description?: string;
  tags?: string;
  format?: string;
}

function cap(s: string | undefined | null): string {
  if (!s) return DASH;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// The actual model is the most accurate from a generated unit's trust/provenance;
// fall back to the book's pinned generation template. `null` model = the
// provider's registry default.
function modelLabel(book: Book | null): string {
  for (const topic of Object.values(book?.content ?? {})) {
    const prov = topic.trust?.provenance ?? topic.provenance;
    if (prov?.model) return prov.model_verified ? `${prov.model} ✓` : prov.model;
  }
  const params = book?.generationParams;
  if (!params) return DASH;
  if (params.model) return params.model;
  return params.provider ? `${params.provider} (default model)` : DASH;
}

function pagesLabel(book: Book | null): string {
  const pages = book?.generationParams?.pages;
  if (pages == null) return DASH;
  return pages === 0 ? "No limit" : String(pages);
}

// Pure derivation of the displayed rows — exported so it can be unit-tested
// without rendering.
export function deriveRows(book: Book | null, fallback: BookMetaFallback): BookMetadataRows {
  const params = book?.generationParams;
  const meta = book?.metadata;
  return {
    name: book?.title ?? fallback.title,
    released: formatDate(meta?.releaseDate ?? fallback.compiledAt),
    model: modelLabel(book),
    level: cap(params?.level),
    depth: cap(params?.depth),
    diagrams: cap(params?.diagramRegister),
    pages: pagesLabel(book),
    reviewedBy: meta?.reviewedBy ?? NOT_REVIEWED,
    reviewedOn: meta?.reviewedOn ? formatDate(meta.reviewedOn) : DASH,
    description: meta?.description || undefined,
    format: meta?.format || undefined,
    tags: meta?.tags && meta.tags.length > 0 ? meta.tags.join(", ") : undefined,
  };
}

function Row({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const muted = value === DASH || value === NOT_REVIEWED;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && styles.rowValueMuted]} selectable>
        {value}
      </Text>
    </View>
  );
}

export interface BookMetadataModalProps {
  visible: boolean;
  book: Book | null;
  meta: BookMetaFallback | null;
  loading?: boolean;
  // Export/published availability, shown under the title (moved here from the
  // old shelf pull-out — spines are now the only shelf visual).
  exportStatus?: BookExportStatus;
  published?: PublishedFormats;
  reviewCount?: number;
  onRead: () => void;
  // Action buttons render only when their handler is provided, so the sidebar
  // degrades gracefully (and this change stays additive for callers).
  onMove?: () => void;
  // Opens the authored book's home (edit / generate / publish / Convert to Project).
  // Only wired for authored books — restores the actions that were orphaned when
  // the Studio/Books tab was removed from the nav.
  onManage?: () => void;
  onReviews?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function BookMetadataModal({
  visible,
  book,
  meta,
  loading = false,
  exportStatus,
  published,
  reviewCount,
  onRead,
  onMove,
  onManage,
  onReviews,
  onDelete,
  onClose,
}: BookMetadataModalProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!visible) return null;
  const rows = deriveRows(book, meta ?? { title: "" });

  return (
    // Non-blocking overlay: the container passes touches through (`box-none`) so
    // the book shelf behind stays tappable — tapping another book just re-points
    // the sidebar instead of closing it. The scrim is visual-only (`none`); only
    // the docked panel captures taps. Dismiss via the Close button.
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.scrim} pointerEvents="none" />
      <View style={styles.sidebar}>
        <Text style={styles.title} numberOfLines={3}>
          {rows.name}
        </Text>
        <ExportStatusPills status={exportStatus} published={published} />
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : (
          <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
            <Row styles={styles} label="Date Released" value={rows.released} />
            {rows.format ? <Row styles={styles} label="Format" value={rows.format} /> : null}
            <Row styles={styles} label="Model Used" value={rows.model} />
            <Row styles={styles} label="Level" value={rows.level} />
            <Row styles={styles} label="Depth" value={rows.depth} />
            <Row styles={styles} label="Type of Diagrams" value={rows.diagrams} />
            <Row styles={styles} label="Pages (target)" value={rows.pages} />
            <Row styles={styles} label="Reviewed By" value={rows.reviewedBy} />
            <Row styles={styles} label="Reviewed On" value={rows.reviewedOn} />
            {rows.description ? <Row styles={styles} label="Description" value={rows.description} /> : null}
            {rows.tags ? <Row styles={styles} label="Tags" value={rows.tags} /> : null}
          </ScrollView>
        )}
        <View style={styles.footer}>
          <View style={styles.actions}>
            <Pressable style={styles.readBtn} onPress={onRead} accessibilityRole="button" accessibilityLabel="Read this book">
              <Text style={styles.readBtnText}>Read</Text>
            </Pressable>
            {onManage ? (
              <Pressable style={styles.iconBtn} onPress={onManage} accessibilityRole="button" accessibilityLabel="Book tools — edit, generate, convert to project" hitSlop={8}>
                <Ionicons name="construct-outline" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
            {onMove ? (
              <Pressable style={styles.iconBtn} onPress={onMove} accessibilityRole="button" accessibilityLabel="Move to shelf" hitSlop={8}>
                <Ionicons name="folder-outline" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
            {onReviews ? (
              <Pressable style={styles.iconBtn} onPress={onReviews} accessibilityRole="button" accessibilityLabel="Reviews" hitSlop={8}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.textSecondary} />
                {reviewCount ? <Text style={styles.count}>{reviewCount}</Text> : null}
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable style={styles.iconBtn} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete from library" hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  // Full-screen, touch-transparent layer that the panel + scrim live in.
  overlay: { ...StyleSheet.absoluteFillObject },
  // Faint scrim over the shelf — visual separation only (never blocks taps).
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  // Panel docked to the right edge, starting below the floating profile chip
  // (UserChip: top 8 + 56px avatar + name ≈ 80) so it doesn't cover it.
  sidebar: {
    position: "absolute" as const,
    top: 88,
    right: 0,
    bottom: 0,
    width: 340,
    maxWidth: "92%" as const,
    backgroundColor: c.surface,
    borderLeftWidth: 1,
    borderLeftColor: c.border,
    borderTopLeftRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    // Float above the shelf.
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: -8, height: 0 },
    elevation: 12,
  },
  title: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  loading: { paddingVertical: spacing.xl, alignItems: "center" as const },
  rows: { flex: 1 },
  rowsContent: { gap: spacing.sm },
  row: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowLabel: { fontSize: typography.sizeSm, color: c.textSecondary, flexShrink: 0 },
  rowValue: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.text,
    flexShrink: 1,
    textAlign: "right" as const,
  },
  rowValueMuted: { color: c.textMuted, fontWeight: "400" as const, fontStyle: "italic" as const },
  footer: { gap: spacing.sm, marginTop: spacing.xs },
  actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  iconBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
  count: { fontSize: typography.sizeXs, fontWeight: "700" as const, color: c.textSecondary },
  closeBtn: {
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center" as const,
  },
  closeBtnText: { color: c.textSecondary, fontWeight: "700" as const, fontSize: typography.sizeSm },
  readBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: "center" as const,
  },
  readBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
});
