import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { searchHelpTopics, HelpTopicView } from "@/help";
import { HELP_TOPICS } from "@/help-content";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Help screen — renders the structured, searchable help content (issue #60).
// Topics live in help-content/ so they stay maintainable + indexable; the
// search + rendering logic itself lives in the help engine (@/help).
// A `?topic=<id>` deep link (from contextual HelpButtons) scrolls to + briefly
// highlights that topic.
export default function HelpScreen() {
  const router = useRouter();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [query, setQuery] = useState("");
  const topics = useMemo(() => searchHelpTopics(query, HELP_TOPICS), [query]);

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
                <HelpTopicView
                  topic={t}
                  onLink={(href) => router.push(href as Href)}
                  onAction={(step) => void relaunchStep(step as StepId)}
                />
              </View>
            </View>
          ))
        )}
      </PageContainer>
    </ScrollView>
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
});
