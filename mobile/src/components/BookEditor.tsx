import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { TopicTreeEditor } from "@/components/TopicTreeEditor";
import { saveBook } from "@/storage/bookStore";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { Book, StructuredTOC } from "@/types/book";

interface Props {
  bookId: string | null; // null → create a new book on save
  initialTitle: string;
  initialToc: StructuredTOC;
  // Preserve the original creation time when editing an existing book.
  createdAt?: string;
  onSaved: (book: Book) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

// Title field + editable topic tree + Save. Shared by the new-book flow (after
// structuring) and the saved-book editor.
export function BookEditor({
  bookId,
  initialTitle,
  initialToc,
  createdAt,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [toc, setToc] = useState<StructuredTOC>(initialToc);
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && toc.subjects.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const now = new Date().toISOString();
    const book: Book = {
      id: bookId ?? newId(),
      title: title.trim(),
      toc,
      createdAt: createdAt ?? now,
      updatedAt: now,
    };
    try {
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
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Book title"
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

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  label: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  titleInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
});
