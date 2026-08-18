import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import {
  searchHelpTopics,
  HelpTopicView,
  ancestorIdsForTopic,
  nodeIdForTopic,
  type HelpTreeNode,
} from "@/help";
import { HELP_TOPICS, HELP_TREE } from "@/help-content";
import { relaunchStep, type StepId } from "@/onboarding/firstRunState";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card, Label } from "@/components/ui";

const TOPICS_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));

// Help screen — renders HELP_TREE as a recursive, collapsible accordion
// (Help Tree Restructure, 2026-08-18; was a flat topic list, issue #60).
// Content lives in help-content/ (topics.ts + tree.ts); search + rendering
// logic lives in the help engine (@/help). Search flattens to matching
// topics regardless of tree state. A `?topic=<id>` deep link (from
// contextual HelpButtons) expands every ancestor branch of that topic's
// leaf, then scrolls to + briefly highlights it.
export default function HelpScreen() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const searchResults = useMemo(
    () => (searching ? searchHelpTopics(query, HELP_TOPICS) : []),
    [query, searching],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const [highlight, setHighlight] = useState<string | undefined>(undefined);

  const scrollToNode = useCallback((id: string) => {
    const y = offsets.current[id];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
      setHighlight(id);
    }
  }, []);

  // Deep link: expand every ancestor branch of the leaf whose topicId
  // matches `?topic=<id>` PLUS the leaf itself (ancestorIdsForTopic only
  // returns the branch chain, excluding the matching leaf's own id — without
  // also expanding the leaf, its HelpTopicView card would never render), then
  // scroll to + highlight it once layout settles. `offsets.current` (and
  // `scrollToNode`) are keyed by tree-node id, NOT topicId — every real leaf's
  // node id differs from its topicId (e.g. "leaf-plans" vs "plans") — so the
  // scroll target must be resolved via `nodeIdForTopic`, never `String(topic)`
  // directly, or the lookup is silently always-undefined.
  useEffect(() => {
    if (!topic) return;
    const ancestors = ancestorIdsForTopic(HELP_TREE, String(topic));
    if (ancestors.length === 0) return;
    const targetNodeId = nodeIdForTopic(HELP_TREE, String(topic));
    setExpanded((prev) => new Set([...prev, ...ancestors, ...(targetNodeId ? [targetNodeId] : [])]));
    if (!targetNodeId) return;
    const h = setTimeout(() => scrollToNode(targetNodeId), 250);
    return () => clearTimeout(h);
  }, [topic, scrollToNode]);

  const onLink = useCallback((href: string) => router.push(href as Href), [router]);
  const onAction = useCallback((step: string) => void relaunchStep(step as StepId), []);

  const renderNode = (node: HelpTreeNode, depth: number): React.ReactNode => {
    const isBranch = Boolean(node.children && node.children.length > 0);
    const isOpen = expanded.has(node.id);
    const topicObj = node.topicId ? TOPICS_BY_ID.get(node.topicId) : undefined;

    return (
      <View
        key={node.id}
        style={[styles.node, { paddingLeft: depth * spacing.md }]}
        onLayout={(e: LayoutChangeEvent) => {
          offsets.current[node.id] = e.nativeEvent.layout.y;
          // Intended fallback (not dead code): the deep-link effect above may
          // fire its 250ms scroll before this leaf has laid out (its
          // ancestors just expanded this same render), leaving
          // offsets.current[node.id] unset at scroll time. This re-attempts
          // the scroll the instant THIS node's own layout lands. Keyed by
          // node.id — the same key offsets/scrollToNode use everywhere — via
          // a direct topicId match rather than nodeIdForTopic, since we
          // already have this exact node in hand.
          if (topic && node.topicId === String(topic)) scrollToNode(node.id);
        }}
      >
        <Pressable
          onPress={() => toggle(node.id)}
          accessibilityRole="button"
          accessibilityLabel={node.title}
          accessibilityState={{ expanded: isOpen }}
          testID={isBranch ? `help-branch-${node.id}` : `help-leaf-${node.id}`}
          style={styles.row}
        >
          <Text style={styles.chevron}>{isOpen ? "▾" : "▸"}</Text>
          <Text style={styles.rowTitle}>{node.title}</Text>
        </Pressable>
        {node.blurb ? <Text style={styles.blurb}>{node.blurb}</Text> : null}

        {isOpen && topicObj ? (
          <Card style={[styles.cardInner, highlight === node.id && styles.cardHighlight]}>
            <HelpTopicView topic={topicObj} onLink={onLink} onAction={onAction} />
          </Card>
        ) : null}
        {isOpen && isBranch
          ? node.children!.map((child) => renderNode(child, depth + 1))
          : null}
      </View>
    );
  };

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

        {searching ? (
          searchResults.length === 0 ? (
            <Text style={styles.empty}>No help topics match “{query.trim()}”.</Text>
          ) : (
            searchResults.map((t) => (
              <View key={t.id} style={styles.section}>
                <Label tone="secondary">{t.title}</Label>
                <Card style={styles.cardInner}>
                  <HelpTopicView topic={t} onLink={onLink} onAction={onAction} />
                </Card>
              </View>
            ))
          )
        ) : (
          HELP_TREE.map((node) => renderNode(node, 0))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1 },
  title: {
    color: c.text,
    fontSize: typography.sizeXl,
    fontFamily: FRAUNCES.semibold,
    letterSpacing: -0.36,
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
    marginBottom: spacing.sm,
  },
  empty: { color: c.textMuted, fontSize: typography.sizeSm, paddingVertical: spacing.md },
  section: { gap: spacing.xs, marginBottom: spacing.md },
  // Layout only — the surface, border, and padding come from <Card>.
  cardInner: { gap: spacing.sm },
  cardHighlight: { borderColor: c.primary },
  node: { marginBottom: spacing.xs },
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chevron: { width: 16 as const, color: c.textSecondary, fontSize: typography.sizeSm },
  rowTitle: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const, flexShrink: 1 as const },
  blurb: { color: c.textMuted, fontSize: typography.sizeXs, marginLeft: 24 as const, marginBottom: spacing.xs },
});
