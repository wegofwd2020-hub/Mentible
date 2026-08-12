import { useCallback, useState } from "react";
import {
  Image, Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";
import { pickReferenceImage } from "@/lib/pickReferenceImage";
import { Alert } from "@/lib/alert";
import { loadApiKey } from "@/secure/keyStore";
import { type Platform, type PostVariant } from "@/api/derivativesClient";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card, Label } from "@/components/ui";

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
        <Label tone="secondary">Source</Label>
        <TextInput
          accessibilityLabel="Source text"
          style={styles.source}
          multiline
          placeholder="Paste the text you want to turn into posts…"
          placeholderTextColor={theme.textMuted}
          value={source}
          onChangeText={setSource}
        />

        <Label tone="secondary">Platform</Label>
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

        <Label tone="secondary">Tone (optional)</Label>
        <TextInput
          accessibilityLabel="Tone"
          style={styles.tone}
          placeholder="e.g. punchy, professional"
          placeholderTextColor={theme.textMuted}
          value={tone}
          onChangeText={setTone}
        />

        <Label tone="secondary">Reference image (optional)</Label>
        <Text style={styles.helper}>The model takes cues from this — it won't copy it.</Text>
        {image == null ? (
          <Button
            variant="ghost"
            label="Add reference image"
            onPress={() => void onPickImage()}
            accessibilityLabel="Add reference image"
            style={styles.imageBtn}
          />
        ) : (
          <View style={styles.imageRow}>
            <Image source={{ uri: `data:${image.media_type};base64,${image.data}` }} style={styles.thumb} />
            <Button
              variant="ghost"
              label="Remove"
              onPress={() => setImage(null)}
              accessibilityLabel="Remove reference image"
            />
          </View>
        )}

        <Button
          variant="primary"
          label="Make posts"
          onPress={onGenerate}
          busy={busy}
          disabled={!canGenerate}
          accessibilityLabel="Make posts"
          style={styles.generate}
        />

        {status === "failed" && error ? <Text style={styles.error}>{error}</Text> : null}

        {status === "done" && variants.length > 0 ? (
          <View style={styles.results}>
            <Label tone="muted">{humanizeProvenance(provenance)}</Label>
            {variants.map((v, i) => (
              <Card key={i} style={styles.card}>
                <Text style={styles.hook}>{v.hook}</Text>
                <Text style={styles.postBody}>{v.body}</Text>
                {v.hashtags.length > 0 ? <Text style={styles.hashtags}>{v.hashtags.join(" ")}</Text> : null}
                {v.cta ? <Text style={styles.cta}>{v.cta}</Text> : null}
                <Button
                  variant="ghost"
                  label={copiedIndex === i ? "Copied" : "Copy"}
                  onPress={() => void onCopy(v, i)}
                  accessibilityLabel={`Copy post ${i + 1}`}
                  style={styles.copyBtn}
                />
              </Card>
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
  source: {
    minHeight: 120, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    padding: spacing.sm, color: c.text, textAlignVertical: "top" as const,
  },
  tone: {
    borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    padding: spacing.sm, color: c.text,
  },
  helper: { fontSize: typography.sizeXs, color: c.textMuted },
  // Layout only — the fill/border/text now come from <Button variant="ghost">
  // (Studio re-skin straggler sweep); this just keeps the button from
  // stretching to the row's full width.
  imageBtn: { alignSelf: "flex-start" as const },
  imageRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  // The Platform toggle is a two-way selector, not a standalone action —
  // Button has no "selected" state distinct from primary/ghost, and using
  // variant="primary" for the active option would put a second gold pill on
  // screen alongside "Make posts". Kept as a raw Pressable pair; only the
  // retired bold weight below was swept.
  segment: { flexDirection: "row" as const, gap: spacing.xs },
  segmentBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  segmentBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  segmentText: { color: c.text, fontWeight: "500" as const },
  segmentTextActive: { color: c.tileOnGlyph },
  // Layout only — the fill/text now come from <Button variant="primary">.
  generate: { marginTop: spacing.md },
  error: { color: c.error, marginTop: spacing.sm },
  results: { marginTop: spacing.md, gap: spacing.sm },
  // Layout only — the surface, border, and padding now come from <Card>.
  card: { gap: spacing.xs },
  hook: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  postBody: { color: c.text },
  hashtags: { color: c.primary },
  cta: { color: c.text, fontWeight: "500" as const },
  copyBtn: { alignSelf: "flex-start" as const },
});
