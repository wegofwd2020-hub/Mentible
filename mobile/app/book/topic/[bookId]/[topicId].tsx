import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { loadBook, saveBook, setTopicContent } from "@/storage/bookStore";
import { loadApiKey } from "@/secure/keyStore";
import { TopicRenderer } from "@/components/LessonRenderer";
import { TrustBadge } from "@/components/TrustBadge";
import { trustManifestFromTopic } from "@/lib/topicTrust";
import { isUnitStale } from "@/lib/staleness";
import { useGenerateTopic } from "@/hooks/useGenerateTopic";
import { useCurrentProvenance } from "@/hooks/useCurrentProvenance";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book, GeneratedTopic, Subtopic } from "@/types/book";

// Locate the topic's node in the (possibly edited) TOC so regeneration uses the
// current title + subtopics + saved instructions, not a stale snapshot.
function findNode(
  book: Book,
  topicId: string,
): { title: string; subtopics: Subtopic[]; enhancementInstructions?: string } | null {
  for (const s of book.toc.subjects) {
    for (const u of s.units) {
      if (u.id === topicId)
        return {
          title: u.title,
          subtopics: u.subtopics,
          enhancementInstructions: u.enhancementInstructions,
        };
    }
  }
  return null;
}

// Persist per-topic enhancement instructions onto the TOC node (immutably) so
// they stick and re-apply on every future regeneration.
function setNodeInstructions(book: Book, topicId: string, instructions: string): Book {
  return {
    ...book,
    toc: {
      subjects: book.toc.subjects.map((s) => ({
        ...s,
        units: s.units.map((u) =>
          u.id === topicId ? { ...u, enhancementInstructions: instructions || undefined } : u,
        ),
      })),
    },
    updatedAt: new Date().toISOString(),
  };
}

// Renders one book topic's full generated content — lesson plus any tutorial,
// quiz sets, and experiment carried by the topic (e.g. a migrated book) — with
// a per-topic regenerate control for iterating on a single lesson.
export default function BookTopicScreen() {
  const { bookId, topicId } = useLocalSearchParams<{ bookId: string; topicId: string }>();
  const [book, setBook] = useState<Book | null>(null);
  const [topic, setTopic] = useState<GeneratedTopic | null>(null);
  const [loading, setLoading] = useState(true);

  const [panelOpen, setPanelOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

  // Load the key for the book's pinned provider (defaults to anthropic).
  const getApiKey = useCallback(() => loadApiKey(book?.generationParams?.provider), [book]);
  const { status, error, run } = useGenerateTopic({ getApiKey });
  const regenerating = status === "generating";

  // Current provenance for the book's pinned LLM config (ADR-016 D7 staleness).
  // Hook must run before any early return; provider/model default sensibly while
  // the book loads, then re-fetch for the real config. undefined ⇒ no hint.
  const current = useCurrentProvenance(
    book?.generationParams?.provider ?? "anthropic",
    book?.generationParams?.model ?? null,
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      const loaded = bookId ? await loadBook(bookId) : null;
      if (mounted) {
        setBook(loaded);
        setTopic(loaded?.content?.[topicId] ?? null);
        setInstructions((loaded ? findNode(loaded, topicId)?.enhancementInstructions : "") ?? "");
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bookId, topicId]);

  const node = book ? findNode(book, topicId) : null;

  const handleRegenerate = useCallback(async () => {
    if (!book) return;
    const title = node?.title ?? topic?.title ?? "Untitled topic";
    const subtopics = node?.subtopics ?? [];
    const params = book.generationParams ?? DEFAULT_GENERATION_PARAMS;
    const trimmed = instructions.trim();

    // Persist the instruction onto the topic first so it sticks and re-applies
    // on future regenerations, even before this run completes.
    const withInstr = setNodeInstructions(book, topicId, trimmed);
    setBook(withInstr);
    await saveBook(withInstr);

    const result = await run({ title, subtopics, params, instructions: trimmed || undefined });
    if (!result) return; // failure surfaces via `error`

    const next = setTopicContent(withInstr, {
      topicId,
      title,
      lesson: result.lesson,
      generatedAt: new Date().toISOString(),
      provenance: result.provenance,
    });
    setBook(next);
    setTopic(next.content?.[topicId] ?? null);
    setPanelOpen(false);
    await saveBook(next);
  }, [book, node, topic, topicId, instructions, run]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
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

  // A topic with no content yet can still be generated for the first time here.
  const hasContent = Boolean(topic);
  const topicTitle = node?.title ?? topic?.title ?? "Topic";

  // Per-unit trust + provenance indicator (ADR-016 D6 — visible per topic, so a
  // book may legitimately show mixed provenance). Built from the topic's stored
  // provenance/generatedAt; null (badge omitted) when there's nothing to show.
  const trustManifest = topic ? trustManifestFromTopic(topic) : null;
  // undefined while current provenance is loading / on fetch failure ⇒ no hint.
  const stale = isUnitStale(topic?.provenance, current);

  return (
    <View style={styles.screen}>
      {/* Regenerate bar — collapsed to a single action; expands to a level
          picker + confirm so a redo is always a deliberate, costed choice. */}
      <View style={styles.bar}>
        <Text style={styles.barTitle} numberOfLines={1}>
          {topicTitle}
        </Text>
        {regenerating ? (
          <View style={styles.barBusy}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.barBusyText}>Regenerating…</Text>
          </View>
        ) : (
          <Pressable
            style={styles.barBtn}
            onPress={() => setPanelOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={
              hasContent ? "Regenerate this topic" : "Generate this topic"
            }
          >
            <Text style={styles.barBtnText}>
              {hasContent ? "↻ Regenerate" : "Generate"}
            </Text>
          </Pressable>
        )}
      </View>

      {panelOpen && !regenerating && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Enhancement instructions</Text>
          <TextInput
            style={styles.instrInput}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="e.g. Add a diagram for the T-shape; add a worked example."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Enhancement instructions for this topic"
          />
          <Text style={styles.panelHint}>
            Saved on this topic and re-applied each time it’s regenerated. Uses
            the book’s level / depth / pages.
          </Text>
          {error && <Text style={styles.panelError}>{error}</Text>}
          <Pressable
            style={styles.confirmBtn}
            onPress={handleRegenerate}
            accessibilityRole="button"
            accessibilityLabel={
              hasContent ? "Regenerate now, overwriting this topic" : "Generate now"
            }
          >
            <Text style={styles.confirmBtnText}>
              {hasContent ? "Regenerate now (overwrite)" : "Generate now"}
            </Text>
          </Pressable>
        </View>
      )}

      {error && !panelOpen && (
        <View style={styles.panel}>
          <Text style={styles.panelError}>{error}</Text>
        </View>
      )}

      {trustManifest && (
        <View style={styles.trust}>
          <TrustBadge
            manifest={trustManifest}
            revisionCount={topic?.revisionCount}
            isStale={stale}
          />
        </View>
      )}

      <View style={styles.body}>
        {topic ? (
          <TopicRenderer topic={topic} />
        ) : (
          <View style={styles.centered}>
            <Text style={styles.missing}>This topic hasn’t been generated yet.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  trust: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  body: { flex: 1 },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  missing: { color: colors.textSecondary, fontSize: typography.sizeMd, textAlign: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  barTitle: { flex: 1, color: colors.text, fontSize: typography.sizeMd, fontWeight: "700" },
  barBtn: {
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  barBtnText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "700" },
  barBusy: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  barBusyText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "600" },
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  panelLabel: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  panelError: { color: colors.error, fontSize: typography.sizeSm },
  instrInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    minHeight: 70,
  },
  panelHint: { color: colors.textMuted, fontSize: typography.sizeXs },
  confirmBtn: {
    backgroundColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  confirmBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
});
