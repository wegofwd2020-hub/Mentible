import { useCallback, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";
import { pickReferenceImage } from "@/lib/pickReferenceImage";
import { Alert } from "@/lib/alert";
import { loadApiKey } from "@/secure/keyStore";
import { type Platform, type PostVariant } from "@/api/derivativesClient";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
          placeholderTextColor={theme.textMuted}
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
          placeholderTextColor={theme.textMuted}
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
          {busy ? <ActivityIndicator color={theme.tileOnGlyph} /> : <Text style={styles.generateText}>Make posts</Text>}
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

const makeStyles = (c: Palette) => ({
  // ScrollView must be flex:1 (a bounded height) so it actually scrolls on web —
  // PageContainer supplies the padding; `body` only spaces the children.
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  body: { gap: spacing.sm },
  label: { fontSize: typography.sizeSm, fontWeight: "600" as const, color: c.text, marginTop: spacing.sm },
  source: {
    minHeight: 120, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    padding: spacing.sm, color: c.text, textAlignVertical: "top" as const,
  },
  tone: {
    borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    padding: spacing.sm, color: c.text,
  },
  helper: { fontSize: typography.sizeXs, color: c.textMuted },
  imageBtn: {
    alignSelf: "flex-start" as const, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  imageBtnText: { color: c.text, fontWeight: "600" as const },
  imageRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  removeImageBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, backgroundColor: c.tileOffFace,
  },
  removeImageBtnText: { color: c.tileOffGlyph, fontWeight: "600" as const },
  segment: { flexDirection: "row" as const, gap: spacing.xs },
  segmentBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  segmentBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  segmentText: { color: c.text, fontWeight: "600" as const },
  segmentTextActive: { color: c.tileOnGlyph },
  generate: {
    marginTop: spacing.md, backgroundColor: c.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center" as const,
  },
  generateDisabled: { opacity: 0.5 },
  generateText: { color: c.tileOnGlyph, fontWeight: "700" as const },
  error: { color: c.error, marginTop: spacing.sm },
  results: { marginTop: spacing.md, gap: spacing.sm },
  provenance: { fontSize: typography.sizeXs, color: c.textMuted, fontStyle: "italic" as const },
  card: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  hook: { fontWeight: "700" as const, color: c.text },
  postBody: { color: c.text },
  hashtags: { color: c.primary },
  cta: { color: c.text, fontWeight: "600" as const },
  copyBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: c.tileOffFace },
  copyText: { color: c.tileOffGlyph, fontWeight: "600" as const },
});
