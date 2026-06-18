import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteBook, hasRenderableLesson, loadBook, loadBookIndex } from "@/storage/bookStore";
import { useCurrentProvenance } from "@/hooks/useCurrentProvenance";
import { countStaleTopics } from "@/lib/staleness";
import { BookCover } from "@/components/BookCover";
import { HelpButton } from "@/components/HelpButton";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book, BookMeta } from "@/types/book";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function progressLabel(m: BookMeta): string | undefined {
  if (typeof m.generatedCount !== "number" || m.unitCount === 0) return undefined;
  return m.generatedCount >= m.unitCount ? `${m.unitCount}` : `${m.generatedCount}/${m.unitCount}`;
}

function NewBookButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.newBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel="New book">
      <Text style={styles.newBtnText}>+ New book</Text>
    </Pressable>
  );
}
function ImportButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.importBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel="Import a book">
      <Text style={styles.importBtnText}>Import a book</Text>
    </Pressable>
  );
}
function BooksHeader({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <View style={styles.header}>
      <NewBookButton onPress={onNew} />
      <ImportButton onPress={onImport} />
      <HelpButton topic="formats" label="Books & formats" />
    </View>
  );
}

// Right-hand detail panel (wide screens) — loads the full book for a description
// and a contents preview, Calibre-style.
function BookDetail({
  id,
  onOpen,
  onGenerate,
  onDelete,
}: {
  id: string | null;
  onOpen: (id: string) => void;
  onGenerate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let m = true;
    if (!id) {
      setBook(null);
      return;
    }
    setLoading(true);
    loadBook(id).then((b) => {
      if (m) {
        setBook(b);
        setLoading(false);
      }
    });
    return () => {
      m = false;
    };
  }, [id]);

  // Staleness rollup (ADR-016 D7) — the book's current pin-resolved provenance,
  // fetched once + cached. Called before the early returns (hooks rule); while no
  // book is loaded it harmlessly resolves the anthropic default (cached, key-free).
  const current = useCurrentProvenance(
    book?.generationParams?.provider ?? "anthropic",
    book?.generationParams?.model ?? null,
  );

  if (!id) {
    return (
      <View style={styles.detailEmpty}>
        <Ionicons name="book-outline" size={40} color={colors.textMuted} />
        <Text style={styles.detailEmptyText}>Select a book to see its details.</Text>
      </View>
    );
  }
  if (loading || !book) {
    return (
      <View style={styles.detailEmpty}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const units = book.toc.subjects.flatMap((s) => s.units);
  const content = book.content ?? {};
  const generated = units.filter((u) => u.id && hasRenderableLesson(content[u.id])).length;
  // Degradation rollup (ADR-016 D7): how many generated topics were made with an
  // older model than the book's current config. 0 when offline / can't tell.
  const staleCount = countStaleTopics(Object.values(content), current);
  const synopsis = units
    .map((u) => (u.id && content[u.id] ? content[u.id].lesson.synopsis : undefined))
    .find(Boolean);

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.detailCover}>
        <BookCover title={book.title} size="large" />
      </View>
      <Text style={styles.detailTitle}>{book.title}</Text>
      <Text style={styles.detailMeta}>
        {book.toc.subjects.length} subject{book.toc.subjects.length === 1 ? "" : "s"} · {units.length} topic
        {units.length === 1 ? "" : "s"} · {formatDate(book.updatedAt)}
      </Text>
      <Text style={[styles.detailMeta, generated >= units.length && units.length > 0 && styles.detailDone]}>
        {generated >= units.length && units.length > 0
          ? `✓ All ${units.length} topics generated`
          : `${generated} / ${units.length} topics generated`}
      </Text>

      {staleCount > 0 && (
        <Pressable
          style={styles.staleRow}
          onPress={() => onGenerate(book.id)}
          accessibilityRole="button"
          accessibilityHint="Opens the generation screen to refresh stale topics"
        >
          <Ionicons name="refresh-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.staleText}>
            {staleCount} {staleCount === 1 ? "topic was" : "topics were"} made with an older
            model — regenerate?
          </Text>
        </Pressable>
      )}

      {synopsis ? (
        <Text style={styles.detailDesc}>{synopsis}</Text>
      ) : (
        <Text style={styles.detailDescMuted}>No content generated yet.</Text>
      )}

      <Text style={styles.contentsLabel}>Contents</Text>
      {units.slice(0, 12).map((u, i) => (
        <View key={u.id ?? i} style={styles.tocRow}>
          <Text style={[styles.tocMark, u.id && hasRenderableLesson(content[u.id]) ? styles.tocDone : undefined]}>
            {u.id && hasRenderableLesson(content[u.id]) ? "✓" : "○"}
          </Text>
          <Text style={styles.tocTitle} numberOfLines={1}>{u.title}</Text>
        </View>
      ))}
      {units.length > 12 && <Text style={styles.tocMore}>+{units.length - 12} more</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.actionPrimary} onPress={() => onOpen(book.id)} accessibilityRole="button">
          <Text style={styles.actionPrimaryText}>Open</Text>
        </Pressable>
        <Pressable style={styles.actionSecondary} onPress={() => onGenerate(book.id)} accessibilityRole="button">
          <Text style={styles.actionSecondaryText}>Generate</Text>
        </Pressable>
        <Pressable
          style={styles.actionDelete}
          onPress={() => onDelete(book.id)}
          accessibilityRole="button"
          accessibilityLabel={`Delete book: ${book.title}`}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function BooksScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { isDesktop } = useResponsive();

  useFocusEffect(
    useCallback(() => {
      loadBookIndex().then((list) => {
        setBooks(list);
        setSelectedId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id ?? null));
      });
    }, []),
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteBook(id);
    setBooks((prev) => {
      const next = prev.filter((m) => m.id !== id);
      setSelectedId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
  }, []);

  const openBook = useCallback((id: string) => router.push(`/book/saved/${id}`), [router]);
  const generateBook = useCallback((id: string) => router.push(`/book/generate/${id}`), [router]);

  if (books.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📖</Text>
        <Text style={styles.emptyTitle}>No books yet</Text>
        <Text style={styles.emptyBody}>
          Paste a table of contents and we’ll turn it into an editable topic tree you can build a book from.
        </Text>
        <NewBookButton onPress={() => router.push("/book/new")} />
        <ImportButton onPress={() => router.push("/book/import")} />
      </View>
    );
  }

  const header = (
    <BooksHeader onNew={() => router.push("/book/new")} onImport={() => router.push("/book/import")} />
  );

  // ── Wide: list of covers on the left, detail panel on the right ────────────
  if (isDesktop) {
    return (
      <View style={styles.split}>
        <FlatList
          style={styles.leftPane}
          contentContainerStyle={styles.leftContent}
          data={books}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={styles.rowSep} />}
          renderItem={({ item }) => {
            const selected = item.id === selectedId;
            return (
              <Pressable
                style={[styles.listRow, selected && styles.listRowSelected]}
                onPress={() => setSelectedId(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Select book: ${item.title}`}
              >
                <View style={styles.rowCover}>
                  <BookCover title={item.title} badge={progressLabel(item)} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.rowMeta}>
                    {item.unitCount} topic{item.unitCount === 1 ? "" : "s"} · {formatDate(item.updatedAt)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
        <View style={styles.rightPane}>
          <BookDetail id={selectedId} onOpen={openBook} onGenerate={generateBook} onDelete={handleDelete} />
        </View>
      </View>
    );
  }

  // ── Phone: cover grid; tap opens the saved-book screen ─────────────────────
  return (
    <FlatList
      key="grid2"
      style={styles.list}
      contentContainerStyle={styles.gridContent}
      data={books}
      keyExtractor={(i) => i.id}
      numColumns={2}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <Pressable
          style={[styles.tile, styles.tileHalf]}
          onPress={() => openBook(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open book: ${item.title}`}
        >
          <BookCover title={item.title} badge={progressLabel(item)} />
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.tileMeta}>{item.unitCount} topics</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  header: { marginBottom: spacing.md },
  empty: {
    flex: 1, backgroundColor: colors.background, justifyContent: "center",
    alignItems: "center", padding: spacing.xl, gap: spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  emptyBody: { fontSize: typography.sizeSm, color: colors.textMuted, textAlign: "center", lineHeight: 22, maxWidth: 280 },
  newBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", marginBottom: spacing.sm },
  newBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  importBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  importBtnText: { color: colors.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" },

  // Phone grid
  gridContent: { padding: spacing.md },
  gridRow: { gap: spacing.md },
  tile: { flex: 1, marginBottom: spacing.md, gap: spacing.xs },
  tileHalf: { maxWidth: "50%" },
  tileTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  tileMeta: { fontSize: typography.sizeXs, color: colors.textMuted },

  // Wide split
  split: { flex: 1, flexDirection: "row", backgroundColor: colors.background, maxWidth: MAX_WIDE_WIDTH, width: "100%", alignSelf: "center" },
  leftPane: { flex: 4, borderRightColor: colors.border, borderRightWidth: 1 },
  leftContent: { padding: spacing.md },
  rowSep: { height: spacing.sm },
  listRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, alignItems: "center" },
  listRowSelected: { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 },
  rowCover: { width: 42 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  rowMeta: { fontSize: typography.sizeXs, color: colors.textMuted },
  rightPane: { flex: 6, backgroundColor: colors.background },

  // Detail panel
  detailEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  detailEmptyText: { color: colors.textMuted, fontSize: typography.sizeSm },
  detailContent: { padding: spacing.lg, gap: spacing.xs },
  detailCover: { alignItems: "center", marginBottom: spacing.sm },
  detailTitle: { fontSize: typography.sizeXl, fontWeight: "700", color: colors.text },
  detailMeta: { fontSize: typography.sizeSm, color: colors.textMuted },
  detailDone: { color: colors.success, fontWeight: "600" },
  staleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  staleText: { flex: 1, fontSize: typography.sizeSm, color: colors.warning },
  detailDesc: { fontSize: typography.sizeMd, color: colors.textSecondary, lineHeight: 22, marginTop: spacing.sm },
  detailDescMuted: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic", marginTop: spacing.sm },
  contentsLabel: {
    fontSize: typography.sizeXs, fontWeight: "600", color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  tocRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", paddingVertical: 3 },
  tocMark: { width: 16, textAlign: "center", color: colors.textMuted },
  tocDone: { color: colors.success },
  tocTitle: { flex: 1, fontSize: typography.sizeSm, color: colors.text },
  tocMore: { fontSize: typography.sizeXs, color: colors.textMuted, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, alignItems: "center" },
  actionPrimary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  actionPrimaryText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
  actionSecondary: { borderColor: colors.primary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  actionSecondaryText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  actionDelete: { marginLeft: "auto", padding: spacing.sm },
});
