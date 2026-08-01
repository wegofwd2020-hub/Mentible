import React from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { hasRenderableLesson } from "@/storage/bookStore";
import type { Book } from "@/types/book";

interface TopicEntry {
  id: string;
  title: string;
  subject: string;
  hasContent: boolean;
  kind: "topic" | "chapter";
}

// Flatten the TOC to readable topic rows, marking which ones have generated /
// imported content. Topics without a stable id can't be keyed to content, so
// they're skipped (they predate generate-all and never carry content).
function flatten(book: Book): TopicEntry[] {
  const content = book.content ?? {};
  const chapters = book.chapters ?? {};
  const out: TopicEntry[] = [];
  for (const s of book.toc.subjects) {
    for (const u of s.units) {
      if (!u.id) continue;
      const chapter = chapters[u.id];
      out.push({
        id: u.id,
        title: u.title,
        subject: s.subject_label,
        hasContent: chapter ? true : hasRenderableLesson(content[u.id]),
        kind: chapter ? "chapter" : "topic",
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
  onOpen: (id: string, kind: "topic" | "chapter") => void;
}) {
  const styles = useThemedStyles(makeStyles);
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
          onPress={() => onOpen(t.id, t.kind)}
          accessibilityRole="button"
          accessibilityLabel={
            t.hasContent
              ? `Read ${t.kind === "chapter" ? "chapter" : "topic"}: ${t.title}`
              : `${t.title} — not generated yet`
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

const makeStyles = (c: Palette) => ({
  root: { gap: spacing.xs },
  heading: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  row: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  rowDisabled: { opacity: 0.5 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: typography.sizeMd, fontWeight: "600" as const, color: c.text },
  chevron: { fontSize: typography.sizeLg, color: c.primary, fontWeight: "700" as const },
  pending: { fontSize: typography.sizeMd, color: c.textMuted },
});
