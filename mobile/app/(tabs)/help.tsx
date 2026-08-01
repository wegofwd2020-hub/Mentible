import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { searchHelpTopics, HelpTopicView } from "@/help";
import { HELP_TOPICS } from "@/help-content";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

// Help screen — renders the structured, searchable help content (issue #60).
// Topics live in help-content/ so they stay maintainable + indexable; the
// search + rendering logic itself lives in the help engine (@/help).
// A `?topic=<id>` deep link (from contextual HelpButtons) scrolls to + briefly
// highlights that topic.
export default function HelpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 },
  title: {
    fontSize: typography.sizeXl,
    fontWeight: "800" as const,
    color: c.text,
    marginBottom: spacing.xs,
  },
  search: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  empty: { color: c.textMuted, fontSize: typography.sizeSm, paddingVertical: spacing.md },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600" as const,
    color: c.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHighlight: { borderColor: c.primary },
});
