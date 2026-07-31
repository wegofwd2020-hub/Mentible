import { useCallback, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";
import { pickReferenceImage } from "@/lib/pickReferenceImage";
import { Alert } from "@/lib/alert";
import { loadApiKey } from "@/secure/keyStore";
import { type Platform, type PostVariant } from "@/api/derivativesClient";
import { colors, radius, spacing, typography } from "@/constants/theme";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

// One shareable string per variant: hook, body, hashtags, then cta if present.
export function assemblePost(v: PostVariant): string {
  const tags = v.hashtags.join(" ");
  const base = `${v.hook}\n\n${v.body}\n\n${tags}`;
  return v.cta ? `${base}\n\n${v.cta}` : base;
}

// Readable label for the backend's provenance enum (always "ai-generated" today).
// An unknown value shows through rather than being masked.
export function humanizeProvenance(p: string | null): string {
  return p == null || p === "ai-generated" ? "AI-generated" : p;
}

export default function PostsScreen() {
  const { status, error, variants, provenance, run } = useMakePost({
    getApiKey: () => loadApiKey("anthropic"),
  });
  const [source, setSource] = useState("");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [tone, setTone] = useState("");
  const [image, setImage] = useState<{ media_type: string; data: string } | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const busy = status === "generating";
  const canGenerate = source.trim().length > 0 && !busy;

  const onGenerate = useCallback(() => {
    void run({
      sourceText: source.trim(),
      platform,
      ...(tone.trim() ? { tone: tone.trim() } : {}),
      ...(image ? { image } : {}),
    });
  }, [run, source, platform, tone, image]);

  const onPickImage = useCallback(async () => {
    try {
      const picked = await pickReferenceImage();
      if (picked) setImage(picked);
    } catch (e) {
      Alert.alert("Could not add image", e instanceof Error ? e.message : "Try another image.");
    }
  }, []);

  const onCopy = useCallback(async (v: PostVariant, i: number) => {
    await copyText(assemblePost(v));
    setCopiedIndex(i);
    setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500);
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <PageContainer>
        <View style={styles.body}>
        <Text style={styles.label}>Source</Text>
        <TextInput
          accessibilityLabel="Source text"
          style={styles.source}
          multiline
          placeholder="Paste the text you want to turn into posts…"
          placeholderTextColor={colors.textMuted}
          value={source}
          onChangeText={setSource}
        />

        <Text style={styles.label}>Platform</Text>
        <View style={styles.segment}>
          {PLATFORMS.map((p) => {
            const active = p.id === platform;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Platform: ${p.label}`}
                onPress={() => setPlatform(p.id)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Tone (optional)</Text>
        <TextInput
          accessibilityLabel="Tone"
          style={styles.tone}
          placeholder="e.g. punchy, professional"
          placeholderTextColor={colors.textMuted}
          value={tone}
          onChangeText={setTone}
        />

        <Text style={styles.label}>Reference image (optional)</Text>
        <Text style={styles.helper}>The model takes cues from this — it won't copy it.</Text>
        {image == null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add reference image"
            onPress={() => void onPickImage()}
            style={styles.imageBtn}
          >
            <Text style={styles.imageBtnText}>Add reference image</Text>
          </Pressable>
        ) : (
          <View style={styles.imageRow}>
            <Image source={{ uri: `data:${image.media_type};base64,${image.data}` }} style={styles.thumb} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove reference image"
              onPress={() => setImage(null)}
              style={styles.removeImageBtn}
            >
              <Text style={styles.removeImageBtnText}>Remove</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Make posts"
          accessibilityState={{ disabled: !canGenerate }}
          disabled={!canGenerate}
          onPress={onGenerate}
          style={[styles.generate, !canGenerate && styles.generateDisabled]}
        >
          {busy ? <ActivityIndicator color={colors.tileOnGlyph} /> : <Text style={styles.generateText}>Make posts</Text>}
        </Pressable>

        {status === "failed" && error ? <Text style={styles.error}>{error}</Text> : null}

        {status === "done" && variants.length > 0 ? (
          <View style={styles.results}>
            <Text style={styles.provenance}>{humanizeProvenance(provenance)}</Text>
            {variants.map((v, i) => (
              <View key={i} style={styles.card}>
                <Text style={styles.hook}>{v.hook}</Text>
                <Text style={styles.postBody}>{v.body}</Text>
                {v.hashtags.length > 0 ? <Text style={styles.hashtags}>{v.hashtags.join(" ")}</Text> : null}
                {v.cta ? <Text style={styles.cta}>{v.cta}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Copy post ${i + 1}`}
                  onPress={() => void onCopy(v, i)}
                  style={styles.copyBtn}
                >
                  <Text style={styles.copyText}>{copiedIndex === i ? "Copied" : "Copy"}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        </View>
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // ScrollView must be flex:1 (a bounded height) so it actually scrolls on web —
  // PageContainer supplies the padding; `body` only spaces the children.
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  body: { gap: spacing.sm },
  label: { fontSize: typography.sizeSm, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  source: {
    minHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, textAlignVertical: "top",
  },
  tone: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text,
  },
  helper: { fontSize: typography.sizeXs, color: colors.textMuted },
  imageBtn: {
    alignSelf: "flex-start", paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  imageBtnText: { color: colors.text, fontWeight: "600" },
  imageRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  removeImageBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, backgroundColor: colors.tileOffFace,
  },
  removeImageBtnText: { color: colors.tileOffGlyph, fontWeight: "600" },
  segment: { flexDirection: "row", gap: spacing.xs },
  segmentBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  segmentBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.text, fontWeight: "600" },
  segmentTextActive: { color: colors.tileOnGlyph },
  generate: {
    marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center",
  },
  generateDisabled: { opacity: 0.5 },
  generateText: { color: colors.tileOnGlyph, fontWeight: "700" },
  error: { color: colors.error, marginTop: spacing.sm },
  results: { marginTop: spacing.md, gap: spacing.sm },
  provenance: { fontSize: typography.sizeXs, color: colors.textMuted, fontStyle: "italic" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  hook: { fontWeight: "700", color: colors.text },
  postBody: { color: colors.text },
  hashtags: { color: colors.primary },
  cta: { color: colors.text, fontWeight: "600" },
  copyBtn: { alignSelf: "flex-start", paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.tileOffFace },
  copyText: { color: colors.tileOffGlyph, fontWeight: "600" },
});
