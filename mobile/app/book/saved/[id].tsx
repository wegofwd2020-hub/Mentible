import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { importBookToProject } from "@/lib/importBookToProject";
import { Alert } from "@/lib/alert";
import { BookEditor } from "@/components/BookEditor";
import { TopicReadList } from "@/components/TopicReadList";
import { SaveToLibraryButton } from "@/components/SaveToLibraryButton";
import { PublishButton } from "@/components/PublishButton";
import { ExportBookJsonButton } from "@/components/ExportBookJsonButton";
import { ShareDraftModal } from "@/components/ShareDraftModal";
import { GenerateAllNarration } from "@/components/GenerateAllNarration";
import { HelpButton } from "@/help";
import { PageContainer } from "@/components/PageContainer";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import type { Book } from "@/types/book";

export default function SavedBookScreen() {
  return (
    <RequireSignIn action="edit a book">
      <SavedBookScreenInner />
    </RequireSignIn>
  );
}

function SavedBookScreenInner() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  // One-time self-serve migration: convert this Studio book → a trust Project
  // (on-device, no backend change; non-destructive). See lib/importBookToProject.
  const convertToProject = useCallback(
    (b: Book, token: string) => {
      Alert.alert(
        "Convert to Project?",
        "Creates a new Project from this book’s outline and drafts — your book stays here. " +
          "The drafts start UNGROUNDED (no sources/citations); add your sources and validate them " +
          "afterwards. Images and quizzes don’t carry over.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Convert",
            onPress: () => {
              void (async () => {
                try {
                  const res = await importBookToProject(b, token);
                  Alert.alert(
                    "Imported to Projects",
                    `${res.topicsImported} topic${res.topicsImported === 1 ? "" : "s"} imported as drafts` +
                      (res.topicsSkipped ? `, ${res.topicsSkipped} outline-only skipped` : "") +
                      ". Add sources, then validate.",
                    [{ text: "Open Project", onPress: () => router.push(`/trust/${res.projectId}`) }],
                  );
                } catch (e) {
                  Alert.alert("Couldn’t convert", e instanceof Error ? e.message : "Please try again.");
                }
              })();
            },
          },
        ],
      );
    },
    [router],
  );

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

  if (!book) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>This book could not be found.</Text>
      </View>
    );
  }

  // Imported third-party content (Open Shelves F1) is read-only: it isn't
  // ours to rewrite (BookEditor, Generate) or to attest as ours (Publish), and
  // SaveToLibraryButton/PublishButton both compile via buildCompilePayload,
  // which carries book.chapters (raw third-party HTML) into a POST to our
  // compiler / the Open Library — the egress ADR-028 D2 forbids ("our infra
  // never hosts/mirrors/proxies a third-party file"). Share draft is the same
  // egress: shareDraft() POSTs `book_json: book` (incl. book.chapters) to our
  // backend's `/${book.id}/share`, so it's gated here too. Read/navigation
  // (TopicReadList) and local export (ExportBookJsonButton) stay available.
  const isImported = book.source === "imported";

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
        <TopicReadList
          book={book}
          onOpen={(id, kind) =>
            router.push(
              kind === "chapter" ? `/book/chapter/${book.id}/${id}` : `/book/topic/${book.id}/${id}`,
            )
          }
        />

        {!isImported && (
          <>
            <BookEditor
              bookId={book.id}
              initialTitle={book.title}
              initialToc={book.toc}
              createdAt={book.createdAt}
              initialDescription={book.metadata?.description}
              initialTags={book.metadata?.tags}
              onSaved={() => router.replace("/books")}
            />

            <Pressable
              style={styles.generateBtn}
              onPress={() => router.push(`/book/generate/${book.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Generate all topics"
            >
              <Text style={styles.generateBtnText}>Generate all topics →</Text>
            </Pressable>
            <Text style={styles.generateHint}>
              Save your edits first. Generation runs one topic at a time against
              your Anthropic key.
            </Text>

            <GenerateAllNarration book={book} onBookChange={setBook} />

            <View style={styles.publishDivider} />
            <Text style={styles.publishLabel}>Publish</Text>
            <SaveToLibraryButton bookId={book.id} />
            <Text style={styles.generateHint}>
              Compiles the generated topics into an EPUB3 and saves it to your
              Library. Generate the topics first.
            </Text>

            <PublishButton bookId={book.id} />
            <Text style={styles.generateHint}>
              Publishes the EPUB + PDF to the Open Library so readers can see and
              download them (their availability shows as green on the shelf).
            </Text>
          </>
        )}

        {accessToken && !isImported ? (
          <>
            <Pressable
              style={styles.generateBtn}
              onPress={() => setShareOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Share this draft"
            >
              <Text style={styles.generateBtnText}>Share draft</Text>
            </Pressable>
            <Text style={styles.generateHint}>
              Invite reviewers by email to read this draft and leave comments
              before you publish it.
            </Text>
            <HelpButton topic="share-a-draft" label="How sharing works" />
            <ShareDraftModal
              visible={shareOpen}
              book={book}
              token={accessToken}
              onClose={() => setShareOpen(false)}
            />

            <Pressable
              style={styles.generateBtn}
              onPress={() => convertToProject(book, accessToken)}
              accessibilityRole="button"
              accessibilityLabel="Convert this book to a Project"
            >
              <Text style={styles.generateBtnText}>Convert to Project</Text>
            </Pressable>
            <Text style={styles.generateHint}>
              Creates a new Project from this book’s outline + drafts (your book
              stays here). Drafts start ungrounded — add sources and validate after.
            </Text>
          </>
        ) : null}

        <ExportBookJsonButton book={book} />
        <Text style={styles.generateHint}>
          Downloads this book as a .book.json file you can back up or re-import
          on another device.
        </Text>
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1 },
  centered: {
    flex: 1 as const,
    backgroundColor: "transparent",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.xl,
  },
  missing: { color: c.textSecondary, fontSize: typography.sizeMd },
  generateBtn: {
    backgroundColor: c.surfaceHigh,
    borderColor: c.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.lg,
  },
  generateBtnText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  generateHint: {
    color: c.textMuted,
    fontSize: typography.sizeXs,
    textAlign: "center" as const,
    marginTop: spacing.xs,
  },
  publishDivider: {
    height: 1,
    backgroundColor: c.border,
    marginTop: spacing.xl,
  },
  publishLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.md,
  },
});
