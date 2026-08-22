import React, { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Alert } from "@/lib/alert";
import { useFocusEffect, useRouter } from "expo-router";
import { deleteEpub, listEpubs, openEpub, type EpubMeta } from "@/storage/epubLibrary";
import { getAllExportStatus, type BookExportStatus } from "@/storage/exportStatus";
import { reconcileGeneratingExports, loadPublishedMap, type PublishedFormats } from "@/lib/trackedExport";
import { reviewCounts } from "@/storage/reviewStore";
import { maybeSeedReviews } from "@/storage/seedReviews";
import { pickEpubFile } from "@/storage/pickBookFile";
import { importEpub } from "@/openshelves/importEpub";
import { BookCover } from "@/components/BookCover";
import { BookMetadataModal } from "@/components/BookMetadataModal";
import { UserChip } from "@/components/UserChip";
import { SharedWithYou } from "@/components/SharedWithYou";
import { useAuth } from "@/auth/AuthProvider";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_WIDE_WIDTH } from "@/constants/layout";
import { spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useThemedStyles } from "@/theme";
import { Button } from "@/components/ui";
import { IS_DEMO } from "@/constants/demo";
import { loadBook, loadBookIndex } from "@/storage/bookStore";
import { seedDefaultLibrary } from "@/storage/seedLibrary";
import { bundledBooks } from "@/storage/bundledLibrary";
import type { Book, BookMeta } from "@/types/book";
import { ShelfBand } from "@/components/ShelfBand";
import { MoveToShelfModal } from "@/components/MoveToShelfModal";
import { ShelfNameModal } from "@/components/ShelfNameModal";
import { groupIntoShelves } from "@/lib/groupShelves";
import {
  assignBook,
  createShelf,
  deleteShelf,
  getAssignments,
  listShelves,
  pruneBook,
  renameShelf,
  type Shelf,
} from "@/storage/shelfStore";

// Demo Library: the bundled books seeded on first run (ADR-017) live in the book
// store, not the EPUB shelf, so the normal EPUB Library would read empty in a
// demo build. Here we surface those books directly on the Library tab — the demo
// lands on a full shelf and taps straight into the reader (/book/saved/[id]).
function DemoLibrary() {
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
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
  const { accessToken } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [items, setItems] = useState<EpubMeta[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<Record<string, BookExportStatus>>({});
  const [published, setPublished] = useState<Record<string, PublishedFormats>>({});
  // Book-metadata window (opened by tapping a book; "Read" enters the reader).
  const [selected, setSelected] = useState<EpubMeta | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [loadingBook, setLoadingBook] = useState(false);
  // Guards against a slow loadBook for an earlier tap landing after a later one.
  const latestReq = useRef<string | null>(null);
  const { isDesktop } = useResponsive();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  // The book whose move-to-shelf picker is open (null = closed).
  const [moveTarget, setMoveTarget] = useState<EpubMeta | null>(null);
  // The shelf-name modal: create, or rename an existing shelf.
  const [nameModal, setNameModal] = useState<{ mode: "create" | "rename"; shelf?: Shelf } | null>(null);
  // When a shelf is created from the picker, assign this book to it once made.
  const [pendingAssignBookId, setPendingAssignBookId] = useState<string | null>(null);

  const reloadShelves = useCallback(async () => {
    setShelves(await listShelves());
    setAssignments(await getAssignments());
  }, []);

  const reload = useCallback(() => {
    void reloadShelves();
    listEpubs()
      .then(async (list) => {
        setItems(list);
        // Seed the demo review on first sight of the Product Sense book (no-op
        // for every other book), then read counts for the grid badges.
        await Promise.all(list.map((m) => maybeSeedReviews(m.id)));
        setCounts(await reviewCounts(list.map((m) => m.id)));
        setPublished(await loadPublishedMap(list.map((m) => m.id)));
      })
      .catch(() => {
        setItems([]);
        setCounts({});
      });
  }, [reloadShelves]);

  useFocusEffect(
    useCallback(() => {
      reload();
      // Export indicators: show current status, then settle any running job.
      const refreshStatus = () => getAllExportStatus().then(setExportStatus);
      refreshStatus();
      reconcileGeneratingExports().then(refreshStatus);
    }, [reload]),
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteEpub(id);
    await pruneBook(id);
    setItems((prev) => prev.filter((m) => m.id !== id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
      // Parse into a first-class, readable Book (Open Shelves F1) — same path as
      // the Shelves "Import an EPUB" — instead of the old download-only EPUB blob.
      // The book is stored via `importEpub` and opens in the in-app chapter reader.
      const book = await importEpub(new Uint8Array(picked.bytes));
      reload();
      router.push(`/book/read/${book.id}`);
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

  const confirmDeleteBook = useCallback(
    (item: EpubMeta) => {
      Alert.alert("Delete from library?", `“${item.title}” will be removed from this device.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void handleDelete(item.id);
            closeMeta();
          },
        },
      ]);
    },
    [handleDelete, closeMeta],
  );

  const currentShelfId = moveTarget ? assignments[moveTarget.id] ?? null : null;

  const handleAssign = useCallback(
    async (shelfId: string | null) => {
      if (!moveTarget) return;
      setError(null);
      try {
        await assignBook(moveTarget.id, shelfId);
        await reloadShelves();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't move the book.");
      } finally {
        setMoveTarget(null);
      }
    },
    [moveTarget, reloadShelves],
  );

  const handleNameSubmit = useCallback(
    async (name: string) => {
      setError(null);
      try {
        if (nameModal?.mode === "rename" && nameModal.shelf) {
          await renameShelf(nameModal.shelf.id, name);
        } else {
          const shelf = await createShelf(name);
          if (pendingAssignBookId) await assignBook(pendingAssignBookId, shelf.id);
        }
        await reloadShelves();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save the shelf.");
      } finally {
        setNameModal(null);
        setPendingAssignBookId(null);
      }
    },
    [nameModal, pendingAssignBookId, reloadShelves],
  );

  const confirmDeleteShelf = useCallback(
    (shelf: Shelf) => {
      Alert.alert("Delete shelf?", `“${shelf.name}” will be removed. Its books move to Unshelved (books are not deleted).`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setError(null);
            void deleteShelf(shelf.id)
              .then(reloadShelves)
              .catch((e) => {
                setError(e instanceof Error ? e.message : "Couldn't delete the shelf.");
              });
          },
        },
      ]);
    },
    [reloadShelves],
  );

  const newShelfButton = (
    <Button
      variant="ghost"
      label="+ New shelf"
      onPress={() => {
        setPendingAssignBookId(null);
        setNameModal({ mode: "create" });
      }}
      accessibilityLabel="Create a new shelf"
    />
  );

  const importButton = (
    <Button
      variant="ghost"
      label="Import EPUB"
      busy={importing}
      onPress={handleImport}
      accessibilityLabel="Import an EPUB file into your library"
    />
  );

  // Studio (authoring) is hidden from the nav (navItems.ts) — this is the
  // persistent path to it, so authors can always reach their books.
  // The create entry point from the Library — starts an SME project (ADR-037).
  const createButton = (
    <Button
      variant="ghost"
      label="Start Creating"
      onPress={() => router.push("/projects")}
      accessibilityLabel="Start creating — go to Projects"
    />
  );

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <SharedWithYou token={accessToken} />
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>Your Library is empty</Text>
        <Text style={styles.emptyBody}>
          Start a project to create your first book, or import an EPUB you already
          have.
        </Text>
        {importButton}
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          variant="primary"
          label="Start Creating →"
          onPress={() => router.push("/projects")}
          accessibilityLabel="Start creating — go to Projects"
        />
      </View>
    );
  }

  const sections = groupIntoShelves(items, shelves, assignments);

  const list = (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.gridContent, isDesktop && styles.gridWide]}
      data={sections}
      keyExtractor={(sec) => sec.shelf?.id ?? "__unshelved__"}
      ListHeaderComponent={
        <View>
          <SharedWithYou token={accessToken} />
          <View style={styles.header}>
            {createButton}
            {importButton}
            {newShelfButton}
            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        </View>
      }
      renderItem={({ item: sec }) => (
        <ShelfBand
          shelf={sec.shelf}
          books={sec.books}
          onPressBook={openMeta}
          onRename={() => sec.shelf && setNameModal({ mode: "rename", shelf: sec.shelf })}
          onDeleteShelf={() => sec.shelf && confirmDeleteShelf(sec.shelf)}
        />
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
        exportStatus={selected ? exportStatus[selected.id] : undefined}
        published={selected ? published[selected.id] : undefined}
        reviewCount={selected ? counts[selected.id] : undefined}
        onRead={() => {
          const item = selected;
          closeMeta();
          if (item) openItem(item);
        }}
        onMove={() => selected && setMoveTarget(selected)}
        onReviews={() => {
          const item = selected;
          closeMeta();
          if (item) openReviews(item);
        }}
        onDelete={() => selected && confirmDeleteBook(selected)}
        onClose={closeMeta}
      />
      <MoveToShelfModal
        visible={!!moveTarget}
        shelves={shelves}
        currentShelfId={currentShelfId}
        onAssign={handleAssign}
        onCreateShelf={() => {
          if (moveTarget) setPendingAssignBookId(moveTarget.id);
          setMoveTarget(null);
          setNameModal({ mode: "create" });
        }}
        onClose={() => setMoveTarget(null)}
      />
      <ShelfNameModal
        visible={!!nameModal}
        title={nameModal?.mode === "rename" ? "Rename shelf" : "New shelf"}
        initialName={nameModal?.shelf?.name}
        onSubmit={handleNameSubmit}
        onClose={() => {
          setNameModal(null);
          setPendingAssignBookId(null);
        }}
      />
    </>
  );
}

const makeStyles = (c: Palette) => ({
  // Demo Library (bundled-books shelf) — small, left-packed cover thumbnails.
  demoShelf: { flex: 1, backgroundColor: "transparent" },
  demoContent: { padding: spacing.md, maxWidth: MAX_WIDE_WIDTH, width: "100%" as const, alignSelf: "center" as const },
  demoHeader: {
    color: c.text, fontSize: typography.sizeXl, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36,
    marginBottom: spacing.md,
  },
  demoGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.lg },
  demoTile: { marginBottom: spacing.sm, gap: spacing.xs },
  // Small (sizeXs) caption under a book cover — stays Inter, medium weight (the
  // Studio system retires bold/700 in favour of 500 for emphasis at this scale).
  demoTileTitle: { fontSize: typography.sizeXs, fontWeight: "500" as const, color: c.text },
  demoTileMeta: { fontSize: typography.sizeXs, color: c.textMuted },

  list: { flex: 1, backgroundColor: "transparent" },
  gridContent: { padding: spacing.md },
  gridWide: { maxWidth: MAX_WIDE_WIDTH, width: "100%" as const, alignSelf: "center" as const },
  screen: { flex: 1 },
  // Import sits left so it clears the floating profile chip (top-right). gap
  // keeps the two ghost-pill <Button>s from touching (Studio re-skin P2).
  header: { flexDirection: "row" as const, justifyContent: "flex-start" as const, alignItems: "center" as const, gap: spacing.sm, marginBottom: spacing.md },
  errorText: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  empty: {
    flex: 1,
    backgroundColor: "transparent",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: c.textMuted,
    textAlign: "center" as const,
    lineHeight: 22,
    maxWidth: 300,
  },
});
