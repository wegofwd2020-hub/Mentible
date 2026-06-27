import React, { useCallback, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteEpub, listEpubs, openEpub, saveEpub, type EpubMeta } from "@/storage/epubLibrary";
import { reviewCounts } from "@/storage/reviewStore";
import { maybeSeedReviews } from "@/storage/seedReviews";
import { pickEpubFile } from "@/storage/pickBookFile";
import { extractEpubCover } from "@/storage/epubCover";
import { BookCover } from "@/components/BookCover";
import { BookMetadataModal } from "@/components/BookMetadataModal";
import { UserChip } from "@/components/UserChip";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { IS_DEMO } from "@/constants/demo";
import { loadBook, loadBookIndex } from "@/storage/bookStore";
import { seedDefaultLibrary } from "@/storage/seedLibrary";
import { bundledBooks } from "@/storage/bundledLibrary";
import type { Book, BookMeta } from "@/types/book";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Image MIME for a raster cover's file extension (so the web data: URL is
// labelled correctly — third-party EPUB covers are frequently JPEG/WebP).
function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

// Demo Library: the bundled books seeded on first run (ADR-017) live in the book
// store, not the EPUB shelf, so the normal EPUB Library would read empty in a
// demo build. Here we surface those books directly on the Library tab — the demo
// lands on a full shelf and taps straight into the reader (/book/saved/[id]).
function DemoLibrary() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  // Fixed, icon-sized covers that left-pack and wrap — so 2 books read as small
  // thumbnails rather than each stretching to half the (wide) screen.
  const tileW = isDesktop ? 172 : 132;
  const [books, setBooks] = useState<BookMeta[]>([]);

  // Await the (idempotent) seed before listing, so the very first launch shows the
  // bundled books rather than racing the async seed in _layout and rendering empty.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        await seedDefaultLibrary(bundledBooks).catch(() => {});
        const list = await loadBookIndex();
        if (active) setBooks(list);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <ScrollView style={styles.demoShelf} contentContainerStyle={styles.demoContent}>
      <Text style={styles.demoHeader}>Your books</Text>
      <View style={styles.demoGrid}>
        {books.map((item) => (
          <Pressable
            key={item.id}
            style={[styles.demoTile, { width: tileW }]}
            onPress={() => router.push(`/book/saved/${item.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Read: ${item.title}`}
          >
            <BookCover title={item.title} coverSvg={item.coverSvg} />
            <Text style={styles.demoTileTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.demoTileMeta}>{item.unitCount} topics</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// The Library: finished books compiled to EPUB3 and stored on this device,
// shown as a cover shelf (Calibre-style). Authored books open in the in-app
// reader; imported EPUBs (no book.json) open via the OS share sheet. Any EPUB
// can be added with "Import EPUB".
//
// Demo builds swap in DemoLibrary so the tab shows the seeded books for reading.
export default function LibraryScreen() {
  // The profile chip floats top-right over whichever shelf renders; it self-gates
  // (hidden in demo/unconfigured, "Sign in" when signed out, photo+name when in).
  return (
    <View style={styles.screen}>
      {IS_DEMO ? <DemoLibrary /> : <EpubLibrary />}
      <UserChip />
    </View>
  );
}

function EpubLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<EpubMeta[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Book-metadata window (opened by tapping a book; "Read" enters the reader).
  const [selected, setSelected] = useState<EpubMeta | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [loadingBook, setLoadingBook] = useState(false);
  // Guards against a slow loadBook for an earlier tap landing after a later one.
  const latestReq = useRef<string | null>(null);
  const { isDesktop } = useResponsive();
  const numColumns = isDesktop ? 4 : 2;

  const reload = useCallback(() => {
    listEpubs()
      .then(async (list) => {
        setItems(list);
        // Seed the demo review on first sight of the Product Sense book (no-op
        // for every other book), then read counts for the grid badges.
        await Promise.all(list.map((m) => maybeSeedReviews(m.id)));
        setCounts(await reviewCounts(list.map((m) => m.id)));
      })
      .catch(() => {
        setItems([]);
        setCounts({});
      });
  }, []);

  useFocusEffect(useCallback(() => reload(), [reload]));

  const handleDelete = useCallback(async (id: string) => {
    await deleteEpub(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleImport = useCallback(async () => {
    setError(null);
    setImporting(true);
    try {
      const picked = await pickEpubFile();
      if (!picked) return; // cancelled
      const head = new Uint8Array(picked.bytes.slice(0, 2));
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
        throw new Error("That doesn't look like an EPUB (zip) file.");
      }
      const title = picked.name.replace(/\.epub$/i, "").trim() || "Imported book";
      const slug =
        title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "epub";
      const cover = extractEpubCover(picked.bytes); // pull the real cover out of the EPUB
      await saveEpub({
        bookId: `imported-${slug}`,
        title,
        bytes: picked.bytes,
        coverSvg: cover?.svg,
        coverBytes: cover?.raster,
        coverMime: cover?.ext ? mimeForExt(cover.ext) : undefined,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import that file.");
    } finally {
      setImporting(false);
    }
  }, [reload]);

  const openItem = useCallback(
    (item: EpubMeta) => {
      // Imported EPUBs have no in-app book.json → share/open externally;
      // authored books open in the in-app reader.
      if (item.id.startsWith("imported-")) {
        openEpub(item.id, item.title).catch((e) =>
          Alert.alert("Couldn't open", e instanceof Error ? e.message : String(e)),
        );
      } else {
        router.push(`/book/read/${item.id}`);
      }
    },
    [router],
  );

  const closeMeta = useCallback(() => {
    latestReq.current = null;
    setSelected(null);
    setSelectedBook(null);
    setLoadingBook(false);
  }, []);

  // Tapping a book opens its metadata window; the full Book (generation params,
  // provenance, editorial review) is loaded lazily. Imported EPUBs have no in-app
  // Book record, so they show only the minimal metadata we hold.
  const openMeta = useCallback((item: EpubMeta) => {
    latestReq.current = item.id;
    setSelected(item);
    setSelectedBook(null);
    if (item.id.startsWith("imported-")) {
      setLoadingBook(false);
      return;
    }
    setLoadingBook(true);
    loadBook(item.id)
      .then((b) => {
        if (latestReq.current === item.id) setSelectedBook(b);
      })
      .catch(() => {
        if (latestReq.current === item.id) setSelectedBook(null);
      })
      .finally(() => {
        if (latestReq.current === item.id) setLoadingBook(false);
      });
  }, []);

  const openReviews = useCallback(
    (item: EpubMeta) => {
      router.push(`/book/reviews/${item.id}?title=${encodeURIComponent(item.title)}`);
    },
    [router],
  );

  const importButton = (
    <Pressable
      style={[styles.importBtn, importing && styles.importBtnDisabled]}
      onPress={handleImport}
      disabled={importing}
      accessibilityRole="button"
      accessibilityLabel="Import an EPUB file into your library"
    >
      <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
      <Text style={styles.importBtnText}>{importing ? "Importing…" : "Import EPUB"}</Text>
    </Pressable>
  );

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>Your Library is empty</Text>
        <Text style={styles.emptyBody}>
          Finish a book in the Books tab and tap “Save to Library”, or import an EPUB
          you already have.
        </Text>
        {importButton}
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/books")}
          accessibilityRole="button"
          accessibilityLabel="Go to Books"
        >
          <Text style={styles.ctaText}>Go to Books →</Text>
        </Pressable>
      </View>
    );
  }

  const list = (
    <FlatList
      key={numColumns}
      style={styles.list}
      contentContainerStyle={[styles.gridContent, isDesktop && styles.gridWide]}
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={numColumns}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={
        <View style={styles.header}>
          {importButton}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.tile, { maxWidth: `${100 / numColumns}%` }]}>
          <Pressable
            onPress={() => openMeta(item)}
            accessibilityRole="button"
            accessibilityLabel={`Book details: ${item.title}`}
          >
            <BookCover title={item.title} badge="EPUB3" coverUri={item.coverUri} coverSvg={item.coverSvg} />
          </Pressable>
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.tileFooter}>
            <Text style={styles.tileMeta} numberOfLines={1}>
              {formatSize(item.sizeBytes)} · {formatDate(item.compiledAt)}
            </Text>
            <Pressable
              onPress={() => openReviews(item)}
              accessibilityRole="button"
              accessibilityLabel={`Reviews for ${item.title}${
                counts[item.id] ? ` (${counts[item.id]})` : ""
              }`}
              hitSlop={8}
              style={styles.reviewsChip}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.textSecondary} />
              {counts[item.id] ? <Text style={styles.reviewsCount}>{counts[item.id]}</Text> : null}
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Delete from library: ${item.title}`}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      )}
    />
  );

  return (
    <>
      {list}
      <BookMetadataModal
        visible={!!selected}
        book={selectedBook}
        meta={selected ? { title: selected.title, compiledAt: selected.compiledAt } : null}
        loading={loadingBook}
        onRead={() => {
          const item = selected;
          closeMeta();
          if (item) openItem(item);
        }}
        onClose={closeMeta}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Demo Library (bundled-books shelf) — small, left-packed cover thumbnails.
  demoShelf: { flex: 1, backgroundColor: colors.background },
  demoContent: { padding: spacing.md, maxWidth: MAX_WIDE_WIDTH, width: "100%", alignSelf: "center" },
  demoHeader: {
    fontSize: typography.sizeXl, fontWeight: "700", color: colors.text,
    marginBottom: spacing.md,
  },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  demoTile: { marginBottom: spacing.sm, gap: spacing.xs },
  demoTileTitle: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.text },
  demoTileMeta: { fontSize: typography.sizeXs, color: colors.textMuted },

  list: { flex: 1, backgroundColor: colors.background },
  gridContent: { padding: spacing.md },
  gridWide: { maxWidth: MAX_WIDE_WIDTH, width: "100%", alignSelf: "center" },
  gridRow: { gap: spacing.md },
  screen: { flex: 1 },
  // Import sits left so it clears the floating profile chip (top-right).
  header: { flexDirection: "row", justifyContent: "flex-start", marginBottom: spacing.md },
  tile: { flex: 1, marginBottom: spacing.lg, gap: spacing.xs },
  tileTitle: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  tileFooter: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tileMeta: { flex: 1, fontSize: typography.sizeXs, color: colors.textMuted },
  reviewsChip: { flexDirection: "row", alignItems: "center", gap: 2 },
  reviewsCount: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary + "1A",
  },
  importBtnDisabled: { opacity: 0.6 },
  importBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  errorText: { color: colors.error, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  empty: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 300,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  ctaText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
