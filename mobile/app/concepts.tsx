// UI CONCEPT GALLERY — prototypes only (not wired to the backend).
//
// Four creative home/compose directions explored to differentiate Mentible in
// the competitive space (AI authoring + visible scoping vs. manual tools like
// Kotobee/Leanpub and consumption marketplaces). Flip between them with the
// switcher to compare on-device, then promote the winner into (tabs)/index.tsx.
// Safe to delete once a direction is chosen. Reachable via Settings → Prototypes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Alert } from "@/lib/alert";
import { BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

const CONCEPTS = ["Lens", "Preview", "Shelf", "One-line"] as const;

export default function ConceptGallery() {
  const styles = useThemedStyles(makeStyles);
  const [active, setActive] = useState(0);
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.switcher}>
        {CONCEPTS.map((name, i) => {
          const on = i === active;
          return (
            <Pressable
              key={name}
              onPress={() => setActive(i)}
              style={[styles.switchTab, on && styles.switchTabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.switchText, on && styles.switchTextOn]}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {active === 0 && <ScopeLens styles={styles} />}
        {active === 1 && <LivingPreview styles={styles} />}
        {active === 2 && <Shelf styles={styles} />}
        {active === 3 && <OneLine styles={styles} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function prototypeTap() {
  Alert.alert("Prototype", "Visual concept only — not wired to generation yet.");
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Segmented({
  options,
  value,
  onChange,
  styles,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.segment, on && styles.segmentOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Cover({ title, hue, styles }: { title: string; hue: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[styles.cover, { borderLeftColor: hue }]}>
      <Text style={styles.coverKicker}>{BRAND_NAME}</Text>
      <Text style={styles.coverTitle} numberOfLines={3}>
        {title}
      </Text>
      <View style={styles.coverFoot}>
        <Text style={styles.coverFootText}>interactive · offline</Text>
      </View>
    </View>
  );
}

// ── Concept 1: Scope Lens ─────────────────────────────────────────────────────

function ScopeLens({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  const theme = useTheme();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("Professional");
  const [prior, setPrior] = useState("Some");
  const [depth, setDepth] = useState("Deep");
  const [format, setFormat] = useState("Lesson");
  return (
    <View style={styles.block}>
      <Image
        source={require("../assets/brand/mentible-icon-1024-redorange.png")}
        style={styles.conceptMark}
        resizeMode="contain"
        accessibilityLabel="Mentible mark"
      />
      <Text style={styles.wordmark}>{BRAND_NAME}</Text>
      <Text style={styles.tagline}>{BRAND_TAGLINE}</Text>

      <Text style={styles.bigPrompt}>Teach me…</Text>
      <TextInput
        style={styles.topicInput}
        placeholder="quantum entanglement"
        placeholderTextColor={theme.textMuted}
        value={topic}
        onChangeText={setTopic}
      />

      <Text style={styles.lensHeader}>◆ Tune your lens</Text>
      <Text style={styles.dimLabel}>Level</Text>
      <Segmented
        options={["Student", "Professional", "Expert"]}
        value={level}
        onChange={setLevel}
        styles={styles}
      />
      <Text style={styles.dimLabel}>Prior knowledge</Text>
      <Segmented options={["None", "Some", "Lots"]} value={prior} onChange={setPrior} styles={styles} />
      <Text style={styles.dimLabel}>Depth</Text>
      <Segmented
        options={["Overview", "Standard", "Deep"]}
        value={depth}
        onChange={setDepth}
        styles={styles}
      />
      <Text style={styles.dimLabel}>Format</Text>
      <Segmented
        options={["Lesson", "Explanation", "Quiz"]}
        value={format}
        onChange={setFormat}
        styles={styles}
      />

      <Pressable style={styles.cta} onPress={prototypeTap}>
        <Text style={styles.ctaText}>Author it →</Text>
      </Pressable>
      <Text style={styles.note}>
        The 6-dimension scoped generation, made tactile — the IP as the interface.
      </Text>
    </View>
  );
}

// ── Concept 2: Living Preview ─────────────────────────────────────────────────

function LivingPreview({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  const theme = useTheme();
  const [topic, setTopic] = useState("photosynthesis");
  const [depth, setDepth] = useState("Standard");
  const title = topic.trim() || "your topic";
  return (
    <View style={styles.block}>
      <Text style={styles.bigPrompt}>Teach me…</Text>
      <TextInput
        style={styles.topicInput}
        placeholder="photosynthesis"
        placeholderTextColor={theme.textMuted}
        value={topic}
        onChangeText={setTopic}
      />
      <Segmented
        options={["Overview", "Standard", "Deep"]}
        value={depth}
        onChange={setDepth}
        styles={styles}
      />

      <Text style={styles.previewLabel}>Live preview</Text>
      <View style={styles.previewCard}>
        <Text style={styles.previewCover} numberOfLines={2}>
          ▣ {title}
        </Text>
        <Text style={styles.previewToc}>1 · First principles</Text>
        <Text style={styles.previewToc}>2 · How it works</Text>
        <Text style={styles.previewToc}>3 · Worked examples</Text>
        <View style={styles.previewMath}>
          <Text style={styles.previewMono}>∫ 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂</Text>
        </View>
        <View style={styles.previewQuiz}>
          <Text style={styles.previewQuizText}>? Quick check ▸</Text>
        </View>
      </View>

      <Pressable style={styles.cta} onPress={prototypeTap}>
        <Text style={styles.ctaText}>Author it →</Text>
      </Pressable>
      <Text style={styles.note}>
        See the artifact’s quality + interactivity before you commit.
      </Text>
    </View>
  );
}

// ── Concept 3: Your Shelf ─────────────────────────────────────────────────────

const SHELF = [
  { title: "TCP/IP, end to end", hue: "#6366f1" },
  { title: "Bayes’ rule, intuitively", hue: "#22c55e" },
  { title: "The Krebs cycle", hue: "#f59e0b" },
  { title: "Stoicism in practice", hue: "#ef4444" },
];

function Shelf({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.block}>
      <Text style={styles.wordmark}>{BRAND_NAME}</Text>
      <Text style={styles.tagline}>Your shelf</Text>

      <View style={styles.grid}>
        {SHELF.map((b) => (
          <Cover key={b.title} title={b.title} hue={b.hue} styles={styles} />
        ))}
        <Pressable style={styles.addCard} onPress={prototypeTap}>
          <Text style={styles.addPlus}>＋</Text>
          <Text style={styles.addText}>Author a new one</Text>
        </Pressable>
      </View>

      <Pressable style={styles.continueRow} onPress={prototypeTap}>
        <Text style={styles.continueText}>▸ Continue: TCP/IP — ch. 3</Text>
      </Pressable>
      <Text style={styles.note}>
        Outputs framed as real, ownable books — a shelf you authored, not rented.
      </Text>
    </View>
  );
}

// ── Concept 4: One line → a book ──────────────────────────────────────────────

const STAGES = ["▣ Designing cover…", "≡ Structuring chapters…", "✍ Writing pages…", "✓ Ready"];

function OneLine({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  const theme = useTheme();
  const [topic, setTopic] = useState("");
  const [stage, setStage] = useState(-1);
  const [showScope, setShowScope] = useState(false);
  const [level, setLevel] = useState("Professional");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const assemble = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(0);
    for (let i = 1; i < STAGES.length; i++) {
      timers.current.push(setTimeout(() => setStage(i), i * 700));
    }
  }, []);

  return (
    <View style={[styles.block, styles.oneLineBlock]}>
      <Text style={styles.oneLineHero}>What do you want to master?</Text>
      <TextInput
        style={[styles.topicInput, styles.oneLineInput]}
        placeholder="the Krebs cycle"
        placeholderTextColor={theme.textMuted}
        value={topic}
        onChangeText={setTopic}
      />
      <Pressable style={styles.cta} onPress={assemble}>
        <Text style={styles.ctaText}>Author →</Text>
      </Pressable>

      <Pressable onPress={() => setShowScope((s) => !s)}>
        <Text style={styles.advanced}>
          {showScope ? "▾ advanced scope" : "▸ advanced scope"}
        </Text>
      </Pressable>
      {showScope && (
        <Segmented
          options={["Student", "Professional", "Expert"]}
          value={level}
          onChange={setLevel}
          styles={styles}
        />
      )}

      {stage >= 0 && (
        <View style={styles.assemble}>
          {STAGES.map((s, i) => (
            <Text
              key={s}
              style={[styles.assembleLine, i <= stage && styles.assembleLineOn]}
            >
              {s}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.note}>
        Dramatizes the authoring “wow” — manual tools can’t show this.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  safe: { flex: 1 as const, backgroundColor: "transparent" },
  scroll: { flex: 1 as const, backgroundColor: "transparent" },
  container: { padding: spacing.md, paddingBottom: spacing.xxl },

  switcher: {
    flexDirection: "row" as const,
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: c.surface,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
  },
  switchTab: {
    flex: 1 as const,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center" as const,
  },
  switchTabOn: { backgroundColor: c.primary + "22" },
  switchText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  switchTextOn: { color: c.primary },

  block: { gap: spacing.sm },
  conceptMark: {
    width: 72,
    height: 72,
    alignSelf: "center" as const,
  },
  wordmark: {
    fontSize: typography.sizeXxl,
    fontWeight: "800" as const,
    color: c.text,
    textAlign: "center" as const,
    marginTop: spacing.sm,
  },
  tagline: {
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    color: c.primary,
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  bigPrompt: {
    fontSize: typography.sizeXl,
    fontWeight: "700" as const,
    color: c.text,
    marginTop: spacing.sm,
  },
  topicInput: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  lensHeader: {
    fontSize: typography.sizeSm,
    fontWeight: "700" as const,
    color: c.primary,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  dimLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  segmented: {
    flexDirection: "row" as const,
    gap: spacing.xs,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  segment: {
    flex: 1 as const,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center" as const,
  },
  segmentOn: { backgroundColor: c.primary },
  segmentText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  segmentTextOn: { color: c.primaryText },

  cta: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
    marginTop: spacing.md,
  },
  ctaText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "700" as const },
  note: {
    fontSize: typography.sizeXs,
    color: c.textMuted,
    fontStyle: "italic" as const,
    marginTop: spacing.sm,
    textAlign: "center" as const,
  },

  previewLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
    marginTop: spacing.md,
  },
  previewCard: {
    backgroundColor: c.surface,
    borderColor: c.borderLight,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewCover: { fontSize: typography.sizeLg, fontWeight: "800" as const, color: c.text },
  previewToc: { fontSize: typography.sizeSm, color: c.textSecondary },
  previewMath: {
    backgroundColor: c.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  previewMono: { color: c.text, fontFamily: typography.fontMono },
  previewQuiz: {
    backgroundColor: c.primary + "1a",
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  previewQuizText: { color: c.primary, fontWeight: "600" as const, fontSize: typography.sizeSm },

  grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm, marginTop: spacing.sm },
  cover: {
    width: "47%" as const,
    minHeight: 120,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    justifyContent: "space-between" as const,
  },
  coverKicker: {
    fontSize: 9,
    fontWeight: "700" as const,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  coverTitle: { fontSize: typography.sizeMd, fontWeight: "700" as const, color: c.text, marginTop: 4 },
  coverFoot: { marginTop: spacing.sm },
  coverFootText: { fontSize: 10, color: c.textMuted },
  addCard: {
    width: "47%" as const,
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderLight,
    borderStyle: "dashed" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
  },
  addPlus: { fontSize: 28, color: c.primary, fontWeight: "300" as const },
  addText: { fontSize: typography.sizeSm, color: c.textSecondary, fontWeight: "600" as const },
  continueRow: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  continueText: { color: c.text, fontWeight: "600" as const, fontSize: typography.sizeSm },

  oneLineBlock: { paddingTop: spacing.xxl },
  oneLineHero: {
    fontSize: typography.sizeXxl,
    fontWeight: "800" as const,
    color: c.text,
    textAlign: "center" as const,
    marginBottom: spacing.md,
  },
  oneLineInput: { fontSize: typography.sizeLg, textAlign: "center" as const },
  advanced: {
    color: c.textMuted,
    fontSize: typography.sizeSm,
    textAlign: "center" as const,
    marginTop: spacing.sm,
  },
  assemble: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  assembleLine: { color: c.textMuted, fontSize: typography.sizeSm },
  assembleLineOn: { color: c.success, fontWeight: "600" as const },
});
