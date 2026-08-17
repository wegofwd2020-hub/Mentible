import { useCallback, useEffect, useState } from "react";
import {
  Image, Pressable, ScrollView, Text, TextInput, View,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useMakePost } from "@/hooks/useMakePost";
import { useMakeCard } from "@/hooks/useMakeCard";
import { copyText } from "@/lib/clipboard";
import { pickReferenceImage } from "@/lib/pickReferenceImage";
import { Alert } from "@/lib/alert";
import { loadApiKey } from "@/secure/keyStore";
import { type CardSize, type Platform, type PostVariant } from "@/api/derivativesClient";
import { useAuth } from "@/auth/AuthProvider";
import { getProject, listOwnedProjects } from "@/api/trustClient";
import { downloadArtifact } from "@/storage/epubLibrary";
import { fromBase64 } from "@/storage/pickBookFile";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Button, Card, Label } from "@/components/ui";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

const MODES: { id: "post" | "card"; label: string }[] = [
  { id: "post", label: "Text post" },
  { id: "card", label: "Image card" },
];

const CARD_SOURCES: { id: "text" | "section"; label: string }[] = [
  { id: "text", label: "Paste text" },
  { id: "section", label: "Pick a validated section" },
];

const SIZES: { id: CardSize; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "story", label: "Story" },
];

interface ValidatedSection { id: string; label: string }

// Flattens every owned project's validated top-level topics into one picker
// list — {latest_version_id, "<project title> — <topic title>"}. A validated
// topic's status is keyed by the top-level TOC unit id (mirrors
// app/trust/[projectId].tsx's assembleBook), never a subtopic. A single
// broken project detail is skipped rather than failing the whole list.
async function fetchValidatedSections(token: string): Promise<ValidatedSection[]> {
  const projects = await listOwnedProjects(token);
  const out: ValidatedSection[] = [];
  for (const p of projects) {
    try {
      const detail = await getProject(p.id, token);
      const statusByTopic = new Map((detail.topic_status ?? []).map((s) => [s.topic_id, s]));
      const toc = detail.project.toc ?? { subjects: [] };
      for (const subject of toc.subjects) {
        for (const unit of subject.units) {
          const status = statusByTopic.get(unit.id);
          if (status?.status === "validated" && status.latest_version_id) {
            out.push({ id: status.latest_version_id, label: `${detail.project.title} — ${unit.title}` });
          }
        }
      }
    } catch {
      // Fail-open per project — one broken project detail doesn't block the rest.
    }
  }
  return out;
}

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

  // ── Image card mode ────────────────────────────────────────────────────
  const [mode, setMode] = useState<"post" | "card">("post");
  const [cardSource, setCardSource] = useState<"text" | "section">("text");
  const [cardText, setCardText] = useState("");
  const [cardSize, setCardSize] = useState<CardSize>("square");
  const [cardTone, setCardTone] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [validatedSections, setValidatedSections] = useState<ValidatedSection[]>([]);

  const { accessToken } = useAuth();
  const {
    status: cardStatus, error: cardError, result: cardResult, run: runCard,
  } = useMakeCard({ getApiKey: () => loadApiKey("anthropic") });

  useEffect(() => {
    if (!accessToken) {
      setValidatedSections([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sections = await fetchValidatedSections(accessToken);
        if (!cancelled) setValidatedSections(sections);
      } catch {
        if (!cancelled) setValidatedSections([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const cardBusy = cardStatus === "generating";
  const canMakeCard =
    !cardBusy
    && ((cardSource === "text" && cardText.trim().length > 0)
      || (cardSource === "section" && selectedSectionId != null));

  const onMakeCard = useCallback(() => {
    void runCard({
      ...(cardSource === "section"
        ? { topic_version_id: selectedSectionId as string }
        : { source_text: cardText.trim() }),
      size: cardSize,
      ...(cardTone.trim() ? { tone: cardTone.trim() } : {}),
    });
  }, [runCard, cardSource, cardText, cardSize, cardTone, selectedSectionId]);

  const onDownloadCard = useCallback(async () => {
    if (!cardResult) return;
    try {
      await downloadArtifact(fromBase64(cardResult.image_png_base64), "card.png", "image/png");
    } catch (e) {
      Alert.alert("Could not download", e instanceof Error ? e.message : "Try again.");
    }
  }, [cardResult]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <PageContainer>
        <View style={styles.body}>
        <View style={styles.segment}>
          {MODES.map((m) => {
            const active = m.id === mode;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Mode: ${m.label}`}
                onPress={() => setMode(m.id)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "card" ? (
          <>
            <Label tone="secondary">Source</Label>
            <View style={styles.segment}>
              {CARD_SOURCES.map((s) => {
                const active = s.id === cardSource;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Card source: ${s.label}`}
                    onPress={() => setCardSource(s.id)}
                    style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {cardSource === "text" ? (
              <TextInput
                accessibilityLabel="Card source text"
                style={styles.source}
                multiline
                placeholder="Paste the text you want to turn into a card…"
                placeholderTextColor={theme.textMuted}
                value={cardText}
                onChangeText={setCardText}
              />
            ) : validatedSections.length === 0 ? (
              <Text style={styles.helper}>
                No validated sections yet — validate a topic in Projects to publish it as a card.
              </Text>
            ) : (
              <View style={styles.sectionsList}>
                {validatedSections.map((s) => {
                  const active = s.id === selectedSectionId;
                  return (
                    <Pressable
                      key={s.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Validated section: ${s.label}`}
                      onPress={() => setSelectedSectionId(s.id)}
                      style={[styles.sectionRow, active && styles.sectionRowActive]}
                    >
                      <Text style={[styles.sectionText, active && styles.sectionTextActive]}>{s.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Label tone="secondary">Size</Label>
            <View style={styles.segment}>
              {SIZES.map((sz) => {
                const active = sz.id === cardSize;
                return (
                  <Pressable
                    key={sz.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Size: ${sz.label}`}
                    onPress={() => setCardSize(sz.id)}
                    style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{sz.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Label tone="secondary">Tone (optional)</Label>
            <TextInput
              accessibilityLabel="Card tone"
              style={styles.tone}
              placeholder="e.g. punchy, professional"
              placeholderTextColor={theme.textMuted}
              value={cardTone}
              onChangeText={setCardTone}
            />

            <Button
              variant="primary"
              label="Make card"
              onPress={onMakeCard}
              busy={cardBusy}
              disabled={!canMakeCard}
              accessibilityLabel="Make card"
              style={styles.generate}
            />

            {cardStatus === "failed" && cardError ? <Text style={styles.error}>{cardError}</Text> : null}

            {cardStatus === "done" && cardResult ? (
              <View style={styles.results}>
                <Label tone="muted">{humanizeProvenance(cardResult.provenance)}</Label>
                <Card style={styles.card}>
                  <Image
                    accessibilityLabel="Card preview"
                    source={{ uri: `data:image/png;base64,${cardResult.image_png_base64}` }}
                    style={styles.cardImage}
                  />
                  <Text style={styles.hook}>{cardResult.card.headline}</Text>
                  <Text style={styles.postBody}>{cardResult.card.subtext}</Text>
                  {cardResult.card.source_label ? <Text style={styles.helper}>{cardResult.card.source_label}</Text> : null}
                  <Button
                    variant="ghost"
                    label="Download"
                    onPress={() => void onDownloadCard()}
                    accessibilityLabel="Download card"
                    style={styles.copyBtn}
                  />
                </Card>
              </View>
            ) : null}
          </>
        ) : (
          <>
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
          </>
        )}
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
  // Card mode: the validated-section picker (a vertical list of rows, unlike
  // the horizontal Platform/Mode/Size segments) and the rendered card image.
  sectionsList: { gap: spacing.xs },
  sectionRow: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  sectionRowActive: { backgroundColor: c.primary, borderColor: c.primary },
  sectionText: { color: c.text },
  sectionTextActive: { color: c.tileOnGlyph },
  cardImage: { width: "100%" as const, aspectRatio: 1, borderRadius: radius.md },
});
