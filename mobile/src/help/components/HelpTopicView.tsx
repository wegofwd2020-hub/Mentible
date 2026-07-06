import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HelpBlock, HelpTopic } from "@/help";
import { colors, radius, spacing, typography } from "@/constants/theme";

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

function Block({
  block,
  onLink,
  onAction,
}: {
  block: HelpBlock;
  onLink: (href: string) => void;
  onAction: (step: string) => void;
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

// Renders one help topic's blocks. `onLink`/`onAction` take plain strings —
// the generic engine schema drops route/step validity; the app re-asserts it
// at the call site (see app/(tabs)/help.tsx).
export function HelpTopicView({
  topic,
  onLink,
  onAction,
}: {
  topic: HelpTopic;
  onLink: (href: string) => void;
  onAction: (step: string) => void;
  highlighted?: boolean;
}): React.JSX.Element {
  return (
    <>
      {topic.blocks.map((b, i) => (
        <Block key={i} block={b} onLink={onLink} onAction={onAction} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
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
