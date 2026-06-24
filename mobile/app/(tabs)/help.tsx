import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { searchHelpTopics, type HelpBlock } from "@/constants/helpContent";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Help screen — renders the structured, searchable help content (issue #60).
// Topics live in constants/helpContent.ts so they stay maintainable + indexable.
// A `?topic=<id>` deep link (from contextual HelpButtons) scrolls to + briefly
// highlights that topic.
export default function HelpScreen() {
  const router = useRouter();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [query, setQuery] = useState("");
  const topics = useMemo(() => searchHelpTopics(query), [query]);

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const [highlight, setHighlight] = useState<string | undefined>(undefined);

  const scrollToTopic = useCallback((id: string) => {
    const y = offsets.current[id];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
      setHighlight(id);
    }
  }, []);

  // Deep link: scroll to the requested topic once layout has settled.
  useEffect(() => {
    if (!topic) return;
    const h = setTimeout(() => scrollToTopic(String(topic)), 250);
    return () => clearTimeout(h);
  }, [topic, scrollToTopic]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
        <Text style={styles.title}>Help</Text>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (highlight) setHighlight(undefined);
          }}
          placeholder="Search help…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search help"
        />

        {topics.length === 0 ? (
          <Text style={styles.empty}>No help topics match “{query.trim()}”.</Text>
        ) : (
          topics.map((t) => (
            <View
              key={t.id}
              style={styles.section}
              onLayout={(e: LayoutChangeEvent) => {
                offsets.current[t.id] = e.nativeEvent.layout.y;
                if (topic === t.id) scrollToTopic(t.id);
              }}
            >
              <Text style={styles.sectionLabel}>{t.title}</Text>
              <View style={[styles.card, highlight === t.id && styles.cardHighlight]}>
                {t.blocks.map((b, i) => (
                  <Block
                    key={i}
                    block={b}
                    onLink={(href) => router.push(href)}
                    onAction={(step) => void relaunchStep(step)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </PageContainer>
    </ScrollView>
  );
}

function Block({
  block,
  onLink,
  onAction,
}: {
  block: HelpBlock;
  onLink: (href: HelpBlockHref) => void;
  onAction: (step: StepId) => void;
}) {
  switch (block.kind) {
    case "text":
      return <Text style={styles.body}>{block.text}</Text>;
    case "steps":
      return (
        <>
          {block.steps.map((s, i) => (
            <Step key={i} n={i + 1} text={s} />
          ))}
        </>
      );
    case "link":
      return (
        <Pressable
          style={styles.linkBtn}
          onPress={() => onLink(block.href)}
          accessibilityRole="button"
          accessibilityLabel={block.label}
        >
          <Text style={styles.linkBtnText}>{block.label}</Text>
        </Pressable>
      );
    case "defs":
      return (
        <>
          {block.defs.map((d, i) => (
            <View key={i} style={styles.def}>
              <Text style={styles.defTerm}>{d.term}</Text>
              <Text style={styles.defText}>{d.def}</Text>
            </View>
          ))}
        </>
      );
    case "action":
      return (
        <Pressable
          style={styles.actionBtn}
          onPress={() => onAction(block.step)}
          accessibilityRole="button"
          accessibilityLabel={block.label}
        >
          <Text style={styles.actionBtnText}>{block.label}</Text>
        </Pressable>
      );
  }
}

// The href type a link block carries (narrowed from HelpBlock).
type HelpBlockHref = Extract<HelpBlock, { kind: "link" }>["href"];

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  title: {
    fontSize: typography.sizeXl,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.sizeMd,
  },
  empty: { color: colors.textMuted, fontSize: typography.sizeSm, paddingVertical: spacing.md },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHighlight: { borderColor: colors.primary },
  body: { fontSize: typography.sizeSm, color: colors.textSecondary, lineHeight: 21 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary + "33",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeXs },
  stepText: { flex: 1, fontSize: typography.sizeSm, color: colors.text, lineHeight: 21 },
  linkBtn: { alignSelf: "flex-start" },
  linkBtnText: { color: colors.primary, fontWeight: "700", fontSize: typography.sizeSm },
  actionBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
  def: { gap: 2 },
  defTerm: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.text },
  defText: { fontSize: typography.sizeSm, color: colors.textSecondary, lineHeight: 20 },
});
