// Author-facing "attach a figure" panel for a topic (media feature slice 2).
// Lets the author add an image (library or camera), edit its caption, or
// delete it. Figures never leave the device — nothing here talks to an LLM.
// Mounted only where `canEdit && topic` on the topic screen (see
// app/book/topic/[bookId]/[topicId].tsx); a read-only viewer never sees this.

import React, { useState } from "react";
import { View, Text, Image, Pressable, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { Book } from "@/types/book";
import { attachImage, deleteImage, pruneOrphanMedia, type PickedImage, MediaCapError } from "@/storage/mediaStore";
import { saveBook } from "@/storage/bookStore";
import { useTopicFigures } from "@/reader/useTopicFigures";
import { Alert } from "@/lib/alert";
import { colors, spacing, typography } from "@/constants/theme";

export function FiguresPanel({
  book, topicId, onBookChange,
}: { book: Book; topicId: string; onBookChange: (b: Book) => void }) {
  const topic = book.content?.[topicId];
  const urls = useTopicFigures(topic);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  // Save is the source of truth; pruning stray media files is best-effort
  // housekeeping (mirrors pruneOrphanMedia's own internal per-file `.catch`)
  // and must never block the save from reaching the caller.
  async function persist(next: Book) {
    await saveBook(next);
    try {
      await pruneOrphanMedia(next);
    } catch {
      // best-effort — a failed prune leaves an orphaned file, not a data bug.
    }
    onBookChange(next);
  }

  async function ingest(asset: ImagePicker.ImagePickerAsset) {
    const src: PickedImage = {
      uri: asset.uri,
      mime: asset.mimeType ?? "image/jpeg",
      width: asset.width, height: asset.height, fileSize: asset.fileSize,
    };
    try {
      setBusy(true);
      await persist(await attachImage(book, topicId, src));
    } catch (e) {
      Alert.alert("Couldn't add figure", e instanceof MediaCapError ? e.message : "Please try another image.");
    } finally {
      setBusy(false);
    }
  }

  async function fromLibrary() {
    setPicking(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Allow photo access to add a figure."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1,
    });
    if (!res.canceled && res.assets[0]) await ingest(res.assets[0]);
  }

  async function fromCamera() {
    setPicking(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission needed", "Allow camera access to take a photo."); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!res.canceled && res.assets[0]) await ingest(res.assets[0]);
  }

  async function remove(imageId: string) {
    setBusy(true);
    try { await persist(await deleteImage(book, topicId, imageId)); }
    finally { setBusy(false); }
  }

  async function editCaption(imageId: string, caption: string) {
    const gen = book.content?.[topicId];
    if (!gen?.images) return;
    const images = gen.images.map((i) => (i.id === imageId ? { ...i, caption } : i));
    const next: Book = {
      ...book,
      content: { ...book.content, [topicId]: { ...gen, images } },
      updatedAt: new Date().toISOString(),
    };
    await persist(next);
  }

  const images = topic?.images ?? [];

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Figures</Text>
        <Pressable
          style={styles.addBtn}
          onPress={() => setPicking((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Add figure to this topic"
          disabled={busy}
        >
          <Text style={styles.addBtnText}>＋ Add figure</Text>
        </Pressable>
      </View>

      {picking && (
        <View style={styles.chooser}>
          <Pressable style={styles.chooserBtn} onPress={fromLibrary}>
            <Text style={styles.chooserText}>Choose from library</Text>
          </Pressable>
          <Pressable style={styles.chooserBtn} onPress={fromCamera}>
            <Text style={styles.chooserText}>Take photo</Text>
          </Pressable>
        </View>
      )}

      {busy && <ActivityIndicator size="small" color={colors.primary} />}

      {images.map((img) => (
        <View key={img.id} style={styles.row}>
          {urls.get(img.id) ? (
            <Image source={{ uri: urls.get(img.id)! }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]} />
          )}
          <TextInput
            style={styles.caption}
            defaultValue={img.caption}
            placeholder="Caption (optional)"
            placeholderTextColor={colors.textMuted}
            onEndEditing={(e) => editCaption(img.id, e.nativeEvent.text)}
            accessibilityLabel="Figure caption"
          />
          <Pressable onPress={() => remove(img.id)} accessibilityLabel="Delete figure">
            <Text style={styles.remove}>✕</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.note}>Figures stay on your device. Nothing is sent to the AI.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: typography.sizeMd, fontWeight: "600", color: colors.text },
  addBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.primary, borderRadius: 8 },
  addBtnText: { color: colors.primaryText, fontWeight: "600" },
  chooser: { flexDirection: "row", gap: spacing.sm },
  chooserBtn: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: "center" },
  chooserText: { color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.surface },
  thumbEmpty: { borderWidth: 1, borderColor: colors.border },
  caption: { flex: 1, color: colors.text, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 4 },
  remove: { color: colors.textMuted, fontSize: typography.sizeLg, paddingHorizontal: spacing.xs },
  note: { color: colors.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" },
});
