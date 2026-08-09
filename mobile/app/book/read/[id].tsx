import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { openEpub } from "@/storage/epubLibrary";
import { TopicReadList } from "@/components/TopicReadList";
import { CheckoutButton } from "@/components/CheckoutButton";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui";
import { HelpButton } from "@/help";
import { spacing, typography, type Palette } from "@/constants/theme";
import { PLAYFAIR } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import type { Book } from "@/types/book";

// Reading view for a Library book: browse its topics (reusing the topic reader)
// and "check out" a copy as EPUB3 or PDF. The Library entry and the source book
// share an id, so we read the source book's content here (Option A).
export default function ReadBookScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const loaded = id ? await loadBook(id) : null;
      if (mounted) {
        setBook(loaded);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // Source book gone (deleted) but the compiled EPUB may still be in the Library.
  if (!book) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>
          The source book is no longer available to read, but you can still
          download the saved EPUB.
        </Text>
        <Button
          variant="primary"
          label="Download EPUB"
          onPress={() => id && openEpub(id, "book").catch(() => {})}
          accessibilityLabel="Download saved EPUB"
        />
      </View>
    );
  }

  // Imported third-party content (Open Shelves F1) is read-only: checkout
  // compiles via CheckoutButton → trackedExport → buildCompilePayload, which
  // carries book.chapters (raw third-party HTML) to the remote compiler —
  // exactly the egress ADR-028 D2 forbids ("our infra never hosts/mirrors/
  // proxies a third-party file"). Reading and navigation stay open.
  const isImported = book.source === "imported";

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <Text style={styles.title}>{book.title}</Text>
        <HelpButton topic="reading-a-book" label="Reading & navigating" />
        <TopicReadList
          book={book}
          onOpen={(id, kind) =>
            router.push(
              kind === "chapter" ? `/book/chapter/${book.id}/${id}` : `/book/topic/${book.id}/${id}`,
            )
          }
        />
        {!isImported && <CheckoutButton book={book} />}
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 },
  title: { fontSize: typography.sizeLg, fontFamily: PLAYFAIR.semibold, letterSpacing: -0.36, color: c.text, marginBottom: spacing.sm },
  centered: {
    flex: 1,
    backgroundColor: c.background,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.xl,
    gap: spacing.md,
  },
  missing: { color: c.textSecondary, fontSize: typography.sizeMd, textAlign: "center" as const, lineHeight: 22 },
});
