// UI CONCEPT GALLERY — prototypes only (not wired to the backend).
//
// Four creative home/compose directions explored to differentiate Mentible in
// the competitive space (AI authoring + visible scoping vs. manual tools like
// Kotobee/Leanpub and consumption marketplaces). Flip between them with the
// switcher to compare on-device, then promote the winner into (tabs)/index.tsx.
// Safe to delete once a direction is chosen. Reachable via Settings → Prototypes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BRAND_NAME, BRAND_TAGLINE } from "@/constants/brand";
import { colors, radius, spacing, typography } from "@/constants/theme";

const CONCEPTS = ["Lens", "Preview", "Shelf", "One-line"] as const;

export default function ConceptGallery() {
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
        {active === 0 && <ScopeLens />}
        {active === 1 && <LivingPreview />}
        {active === 2 && <Shelf />}
        {active === 3 && <OneLine />}
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
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
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

function Cover({ title, hue }: { title: string; hue: string }) {
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

function ScopeLens() {
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
        placeholderTextColor={colors.textMuted}
        value={topic}
        onChangeText={setTopic}
      />

      <Text style={styles.lensHeader}>◆ Tune your lens</Text>
      <Text style={styles.dimLabel}>Level</Text>
      <Segmented
        options={["Student", "Professional", "Expert"]}
        value={level}
        onChange={setLevel}
      />
      <Text style={styles.dimLabel}>Prior knowledge</Text>
      <Segmented options={["None", "Some", "Lots"]} value={prior} onChange={setPrior} />
      <Text style={styles.dimLabel}>Depth</Text>
      <Segmented
        options={["Overview", "Standard", "Deep"]}
        value={depth}
        onChange={setDepth}
      />
      <Text style={styles.dimLabel}>Format</Text>
      <Segmented
        options={["Lesson", "Explanation", "Quiz"]}
        value={format}
        onChange={setFormat}
      />

      <Pressable style={styles.cta} onPress={prototypeTap}>
        <Text style={styles.ctaText}>Author it →</Text>
      </Pressable>
      <Text style={styles.note}>
        The 6-dimension scoped query, made tactile — the IP as the interface.
      </Text>
    </View>
  );
}

// ── Concept 2: Living Preview ─────────────────────────────────────────────────

function LivingPreview() {
  const [topic, setTopic] = useState("photosynthesis");
  const [depth, setDepth] = useState("Standard");
  const title = topic.trim() || "your topic";
  return (
    <View style={styles.block}>
      <Text style={styles.bigPrompt}>Teach me…</Text>
      <TextInput
        style={styles.topicInput}
        placeholder="photosynthesis"
        placeholderTextColor={colors.textMuted}
        value={topic}
        onChangeText={setTopic}
      />
      <Segmented
        options={["Overview", "Standard", "Deep"]}
        value={depth}
        onChange={setDepth}
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

function Shelf() {
  return (
    <View style={styles.block}>
      <Text style={styles.wordmark}>{BRAND_NAME}</Text>
      <Text style={styles.tagline}>Your shelf</Text>

      <View style={styles.grid}>
        {SHELF.map((b) => (
          <Cover key={b.title} title={b.title} hue={b.hue} />
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

function OneLine() {
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
        placeholderTextColor={colors.textMuted}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, paddingBottom: spacing.xxl },

  switcher: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  switchTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  switchTabOn: { backgroundColor: colors.primary + "22" },
  switchText: { color: colors.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" },
  switchTextOn: { color: colors.primary },

  block: { gap: spacing.sm },
  conceptMark: {
    width: 72,
    height: 72,
    alignSelf: "center",
  },
  wordmark: {
    fontSize: typography.sizeXxl,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  tagline: {
    fontSize: typography.sizeSm,
    fontWeight: "600",
    color: colors.primary,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  bigPrompt: {
    fontSize: typography.sizeXl,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.sm,
  },
  topicInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
  },
  lensHeader: {
    fontSize: typography.sizeSm,
    fontWeight: "700",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  dimLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.sm,
  },
  segmented: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  segmentOn: { backgroundColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" },
  segmentTextOn: { color: colors.primaryText },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  ctaText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "700" },
  note: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
    fontStyle: "italic",
    marginTop: spacing.sm,
    textAlign: "center",
  },

  previewLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.md,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewCover: { fontSize: typography.sizeLg, fontWeight: "800", color: colors.text },
  previewToc: { fontSize: typography.sizeSm, color: colors.textSecondary },
  previewMath: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  previewMono: { color: colors.text, fontFamily: typography.fontMono },
  previewQuiz: {
    backgroundColor: colors.primary + "1a",
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  previewQuizText: { color: colors.primary, fontWeight: "600", fontSize: typography.sizeSm },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  cover: {
    width: "47%",
    minHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  coverKicker: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  coverTitle: { fontSize: typography.sizeMd, fontWeight: "700", color: colors.text, marginTop: 4 },
  coverFoot: { marginTop: spacing.sm },
  coverFootText: { fontSize: 10, color: colors.textMuted },
  addCard: {
    width: "47%",
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  addPlus: { fontSize: 28, color: colors.primary, fontWeight: "300" },
  addText: { fontSize: typography.sizeSm, color: colors.textSecondary, fontWeight: "600" },
  continueRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  continueText: { color: colors.text, fontWeight: "600", fontSize: typography.sizeSm },

  oneLineBlock: { paddingTop: spacing.xxl },
  oneLineHero: {
    fontSize: typography.sizeXxl,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  oneLineInput: { fontSize: typography.sizeLg, textAlign: "center" },
  advanced: {
    color: colors.textMuted,
    fontSize: typography.sizeSm,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  assemble: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  assembleLine: { color: colors.textMuted, fontSize: typography.sizeSm },
  assembleLineOn: { color: colors.success, fontWeight: "600" },
});
