import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { TopicTreeEditor } from "@/components/TopicTreeEditor";
import { loadBook, saveBook } from "@/storage/bookStore";
import { loadDefaultParams } from "@/storage/settingsStore";
import { randomUUID } from "@/lib/uuid";
import { parseTags, formatTags } from "@/lib/tags";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import type { Book, StructuredTOC } from "@/types/book";

interface Props {
  bookId: string | null; // null → create a new book on save
  initialTitle: string;
  initialToc: StructuredTOC;
  initialDescription?: string;
  initialTags?: string[];
  // Preserve the original creation time when editing an existing book.
  createdAt?: string;
  onSaved: (book: Book) => void;
}

function newId(): string {
  return randomUUID();
}

// Title field + editable topic tree + Save. Shared by the new-book flow (after
// structuring) and the saved-book editor.
export function BookEditor({
  bookId,
  initialTitle,
  initialToc,
  initialDescription,
  initialTags,
  createdAt,
  onSaved,
}: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [title, setTitle] = useState(initialTitle);
  const [toc, setToc] = useState<StructuredTOC>(initialToc);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [tagsText, setTagsText] = useState(formatTags(initialTags));
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && toc.subjects.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      // Preserve any generated/imported per-topic content across edits — without
      // this, editing a book's title/TOC would wipe its lessons (saveBook prunes
      // content to the current topic ids, dropping orphans of removed topics).
      const existing = bookId ? await loadBook(bookId) : null;
      // New book → seed its template from the global default; existing → keep.
      const generationParams = existing?.generationParams ?? (await loadDefaultParams());
      const book: Book = {
        id: bookId ?? newId(),
        title: title.trim(),
        toc,
        createdAt: createdAt ?? now,
        updatedAt: now,
        content: existing?.content,
        generationParams,
        metadata: {
          ...(existing?.metadata ?? {}),
          description: description.trim() || undefined,
          tags: parseTags(tagsText),
        },
      };
      await saveBook(book);
      onSaved(book);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Book title</Text>
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. My Physics Primer"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Book title"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.descInput}
        value={description}
        onChangeText={setDescription}
        placeholder="A short blurb about this book"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Book description"
        multiline
      />

      <Text style={styles.label}>Tags</Text>
      <TextInput
        style={styles.tagsInput}
        value={tagsText}
        onChangeText={setTagsText}
        placeholder="comma, separated, tags"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Book tags"
        autoCapitalize="none"
      />

      <Text style={styles.label}>Topics</Text>
      <TopicTreeEditor toc={toc} onChange={setToc} />

      <Pressable
        style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityLabel="Save book"
        accessibilityState={{ disabled: !canSave }}
      >
        <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save book"}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  root: { gap: spacing.md },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  titleInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
  },
  descInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
    minHeight: 72,
    textAlignVertical: "top" as const,
  },
  // Free-form tags read as regular body text, not a bold title (a tag field is
  // not a heading — avoids reusing titleInput's sizeLg/700 weight).
  tagsInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  saveBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
});
