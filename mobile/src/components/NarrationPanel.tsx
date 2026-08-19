// Author-facing "narrate this topic" panel (ADR-040 rung 4). Lets the author
// generate a narrated-audio clip for a topic via the shipped P4
// /derivatives/audio engine (generateAndStoreTopicAudio does the call +
// on-device persist), play back what's already attached, or delete a clip.
// Mirrors FiguresPanel's skeleton exactly (busy/persist/header+list+note).
// Mounted only where `canEdit && topic` on the topic screen (see
// app/book/topic/[bookId]/[topicId].tsx); a read-only viewer never sees this.

import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import type { Book } from "@/types/book";
import {
  generateAndStoreTopicAudio,
  AudioGenerateError,
} from "@/lib/audioGenerate";
import {
  deleteAudio,
  pruneOrphanMedia,
  resolveAudioDataUrls,
  MediaCapError,
} from "@/storage/mediaStore";
import { MAX_AUDIO_PER_TOPIC } from "@/storage/mediaPaths";
import { saveBook } from "@/storage/bookStore";
import { lessonToNarratableText } from "@/lib/lessonToNarratableText";
import { loadApiKey } from "@/secure/keyStore";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { AudioNarrationPlayer } from "@/components/AudioNarrationPlayer";
import { Alert } from "@/lib/alert";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

export function NarrationPanel({
  book, topicId, onBookChange,
}: { book: Book; topicId: string; onBookChange: (b: Book) => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const topic = book.content?.[topicId];
  const { plan } = useBillingPlan();
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  // Resolve each attached clip's bytes to a base64 payload for
  // AudioNarrationPlayer. Deferred into a microtask (not called directly in
  // the effect body) so a resolver failure — sync throw or rejection — always
  // lands in .catch rather than escaping the effect uncaught.
  useEffect(() => {
    let live = true;
    if (!topic?.audio?.length) { setUrls(new Map()); return; }
    Promise.resolve()
      .then(() => resolveAudioDataUrls(topic))
      .then((m) => { if (live) setUrls(m); })
      .catch(() => { if (live) setUrls(new Map()); });
    return () => { live = false; };
  }, [topic]);

  // Save is the source of truth; pruning stray media files is best-effort
  // housekeeping (mirrors FiguresPanel's own persist) and must never block
  // the save from reaching the caller.
  async function persist(next: Book) {
    await saveBook(next);
    try {
      await pruneOrphanMedia(next);
    } catch {
      // best-effort — a failed prune leaves an orphaned file, not a data bug.
    }
    onBookChange(next);
  }

  const audio = topic?.audio ?? [];
  const atCap = audio.length >= MAX_AUDIO_PER_TOPIC;

  async function onGenerate() {
    if (!topic) return;
    setBusy(true);
    try {
      const apiKey = await loadApiKey("openai");
      // Fail-open: while the plan is loading (plan == null) or Pro, a no-key
      // run goes keyless and the backend decides — mirrors useMakeAudio's
      // guard exactly.
      const knownNotPro = plan != null && plan.is_pro === false;
      if (!apiKey && knownNotPro) {
        Alert.alert("API key needed", "Add your OpenAI key in Settings to generate narration.");
        return;
      }
      const source_text = lessonToNarratableText(topic.lesson);
      const result = await generateAndStoreTopicAudio({
        book, topicId, source_text, provider_id: "openai",
        ...(apiKey ? { apiKey } : {}),
      });
      await persist(result.book);
    } catch (e) {
      Alert.alert(
        "Couldn't generate narration",
        e instanceof MediaCapError
          ? e.message
          : e instanceof AudioGenerateError
            ? e.message
            : (e as Error)?.message ?? "Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(audioId: string) {
    setBusy(true);
    try { await persist(await deleteAudio(book, topicId, audioId)); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Narration</Text>
        <Pressable
          style={styles.addBtn}
          onPress={onGenerate}
          accessibilityRole="button"
          accessibilityLabel="Generate narration for this topic"
          accessibilityState={{ disabled: busy || atCap }}
          disabled={busy || atCap}
        >
          <Text style={styles.addBtnText}>＋ Generate narration</Text>
        </Pressable>
      </View>

      {busy && <ActivityIndicator size="small" color={theme.primary} />}

      {audio.map((a) => (
        <View key={a.id} style={styles.row}>
          <View style={styles.fields}>
            <Text style={styles.clipTitle}>{a.title ?? "Narration"}</Text>
            {urls.get(a.id) ? (
              <AudioNarrationPlayer base64={urls.get(a.id)!.split(",")[1] ?? ""} mime={a.mime} />
            ) : null}
          </View>
          <Pressable onPress={() => remove(a.id)} accessibilityLabel="Delete narration">
            <Text style={styles.remove}>✕</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.note}>Narration is generated with your OpenAI key and saved into this book.</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { fontSize: typography.sizeMd, fontWeight: "600" as const, color: c.text },
  addBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: c.primary, borderRadius: 8 },
  addBtnText: { color: c.primaryText, fontWeight: "600" as const },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  fields: { flex: 1, gap: spacing.xs },
  clipTitle: { color: c.text },
  remove: { color: c.textMuted, fontSize: typography.sizeLg, paddingHorizontal: spacing.xs },
  note: { color: c.textMuted, fontSize: typography.sizeXs, fontStyle: "italic" as const },
});
