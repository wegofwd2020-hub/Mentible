import React, { useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { pickCoverArtwork } from "@/lib/pickCoverArtwork";
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
  initialAuthor?: string;
  initialCoverImage?: string;
  initialCoverThumb?: string;
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
  initialAuthor,
  initialCoverImage,
  initialCoverThumb,
  initialDescription,
  initialTags,
  createdAt,
  onSaved,
}: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [title, setTitle] = useState(initialTitle);
  const [toc, setToc] = useState<StructuredTOC>(initialToc);
  const [author, setAuthor] = useState(initialAuthor ?? "");
  const [coverImage, setCoverImage] = useState<string | undefined>(initialCoverImage);
  const [coverThumb, setCoverThumb] = useState<string | undefined>(initialCoverThumb);
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [tagsText, setTagsText] = useState(formatTags(initialTags));
  const [saving, setSaving] = useState(false);

  const canSave = title.trim().length > 0 && toc.subjects.length > 0 && !saving;

  const handleChooseArtwork = async () => {
    setArtworkBusy(true);
    setArtworkError(null);
    try {
      const art = await pickCoverArtwork();
      if (art) {
        // null = user cancelled; keep the current artwork
        setCoverImage(art.coverImage);
        setCoverThumb(art.coverThumb);
      }
    } catch (e) {
      setArtworkError(e instanceof Error ? e.message : "Could not add that image.");
    } finally {
      setArtworkBusy(false);
    }
  };

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
          author: author.trim() || undefined,
          coverImage,
          coverThumb,
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

      <Text style={styles.label}>Author</Text>
      <TextInput
        style={styles.tagsInput}
        value={author}
        onChangeText={setAuthor}
        placeholder="Author name (optional)"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Book author"
      />

      <Text style={styles.label}>Cover artwork</Text>
      {coverImage ? (
        <Image
          source={{ uri: coverImage }}
          style={styles.artworkPreview}
          resizeMode="cover"
          accessibilityLabel="Cover artwork preview"
        />
      ) : (
        <Text style={styles.artworkHint}>No artwork yet. The cover uses the generated design.</Text>
      )}
      <View style={styles.artworkRow}>
        <Pressable
          style={styles.artworkBtn}
          onPress={handleChooseArtwork}
          disabled={artworkBusy}
          accessibilityRole="button"
          accessibilityLabel={coverImage ? "Replace cover artwork" : "Choose cover artwork"}
        >
          <Text style={styles.artworkBtnText}>
            {artworkBusy ? "Loading…" : coverImage ? "Replace artwork" : "Choose artwork"}
          </Text>
        </Pressable>
        {coverImage ? (
          <Pressable
            style={styles.artworkBtn}
            onPress={() => {
              setCoverImage(undefined);
              setCoverThumb(undefined);
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove cover artwork"
          >
            <Text style={styles.artworkBtnText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      {artworkError ? <Text style={styles.artworkError}>{artworkError}</Text> : null}

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
  artworkPreview: {
    width: 120,
    height: 180,
    borderRadius: radius.sm,
    borderColor: c.border,
    borderWidth: 1,
  },
  artworkHint: { fontSize: typography.sizeSm, color: c.textMuted },
  artworkRow: { flexDirection: "row" as const, gap: spacing.sm },
  artworkBtn: {
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  artworkBtnText: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
  artworkError: { color: c.error, fontSize: typography.sizeSm },
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
