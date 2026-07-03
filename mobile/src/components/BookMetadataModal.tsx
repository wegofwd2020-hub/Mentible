import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book } from "@/types/book";

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
    tags: meta?.tags && meta.tags.length > 0 ? meta.tags.join(", ") : undefined,
  };
}

function Row({ label, value }: { label: string; value: string }) {
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
  onRead: () => void;
  onClose: () => void;
}

export function BookMetadataModal({
  visible,
  book,
  meta,
  loading = false,
  onRead,
  onClose,
}: BookMetadataModalProps) {
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
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
            <Row label="Date Released" value={rows.released} />
            <Row label="Model Used" value={rows.model} />
            <Row label="Level" value={rows.level} />
            <Row label="Depth" value={rows.depth} />
            <Row label="Type of Diagrams" value={rows.diagrams} />
            <Row label="Pages (target)" value={rows.pages} />
            <Row label="Reviewed By" value={rows.reviewedBy} />
            <Row label="Reviewed On" value={rows.reviewedOn} />
            {rows.description ? <Row label="Description" value={rows.description} /> : null}
            {rows.tags ? <Row label="Tags" value={rows.tags} /> : null}
          </ScrollView>
        )}
        <View style={styles.footer}>
          <Pressable
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
          <Pressable
            style={styles.readBtn}
            onPress={onRead}
            accessibilityRole="button"
            accessibilityLabel="Read this book"
          >
            <Text style={styles.readBtnText}>Read</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-screen, touch-transparent layer that the panel + scrim live in.
  overlay: { ...StyleSheet.absoluteFillObject },
  // Faint scrim over the shelf — visual separation only (never blocks taps).
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  // Panel docked to the right edge, starting below the floating profile chip
  // (UserChip: top 8 + 56px avatar + name ≈ 80) so it doesn't cover it.
  sidebar: {
    position: "absolute",
    top: 88,
    right: 0,
    bottom: 0,
    width: 340,
    maxWidth: "92%",
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
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
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  loading: { paddingVertical: spacing.xl, alignItems: "center" },
  rows: { flex: 1 },
  rowsContent: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: typography.sizeSm, color: colors.textSecondary, flexShrink: 0 },
  rowValue: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.text,
    flexShrink: 1,
    textAlign: "right",
  },
  rowValueMuted: { color: colors.textMuted, fontWeight: "400", fontStyle: "italic" },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.xs },
  closeBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeBtnText: { color: colors.textSecondary, fontWeight: "700", fontSize: typography.sizeSm },
  readBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  readBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
});
