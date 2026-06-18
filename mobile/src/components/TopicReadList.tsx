import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { hasRenderableLesson } from "@/storage/bookStore";
import type { Book } from "@/types/book";

interface TopicEntry {
  id: string;
  title: string;
  subject: string;
  hasContent: boolean;
}

// Flatten the TOC to readable topic rows, marking which ones have generated /
// imported content. Topics without a stable id can't be keyed to content, so
// they're skipped (they predate generate-all and never carry content).
function flatten(book: Book): TopicEntry[] {
  const content = book.content ?? {};
  const out: TopicEntry[] = [];
  for (const s of book.toc.subjects) {
    for (const u of s.units) {
      if (!u.id) continue;
      out.push({
        id: u.id,
        title: u.title,
        subject: s.subject_label,
        hasContent: hasRenderableLesson(content[u.id]),
      });
    }
  }
  return out;
}

// A read-oriented list of a book's topics. Each topic that has content is
// tappable and opens the topic reader; topics not yet generated are shown
// greyed out. Renders nothing when the book has no content at all, so the
// saved-book screen falls back to its edit-only layout.
export function TopicReadList({
  book,
  onOpen,
}: {
  book: Book;
  onOpen: (topicId: string) => void;
}) {
  const topics = flatten(book);
  if (!topics.some((t) => t.hasContent)) return null;

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Read</Text>
      {topics.map((t) => (
        <Pressable
          key={t.id}
          style={[styles.row, !t.hasContent && styles.rowDisabled]}
          disabled={!t.hasContent}
          onPress={() => onOpen(t.id)}
          accessibilityRole="button"
          accessibilityLabel={
            t.hasContent ? `Read topic: ${t.title}` : `${t.title} — not generated yet`
          }
        >
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {t.title}
            </Text>
          </View>
          <Text style={t.hasContent ? styles.chevron : styles.pending}>
            {t.hasContent ? "›" : "—"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  heading: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowDisabled: { opacity: 0.5 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: typography.sizeMd, fontWeight: "600", color: colors.text },
  chevron: { fontSize: typography.sizeLg, color: colors.primary, fontWeight: "700" },
  pending: { fontSize: typography.sizeMd, color: colors.textMuted },
});
