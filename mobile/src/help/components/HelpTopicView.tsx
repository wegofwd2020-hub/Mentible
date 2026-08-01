import React from "react";
import { Pressable, Text, View } from "react-native";
import type { HelpBlock, HelpTopic } from "@/help";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

function Step({ n, text, styles }: { n: number; text: string; styles: ReturnType<typeof makeStyles> }) {
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
  styles,
}: {
  block: HelpBlock;
  onLink: (href: string) => void;
  onAction: (step: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  switch (block.kind) {
    case "text":
      return <Text style={styles.body}>{block.text}</Text>;
    case "steps":
      return (
        <>
          {block.steps.map((s, i) => (
            <Step key={i} n={i + 1} text={s} styles={styles} />
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
}): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      {topic.blocks.map((b, i) => (
        <Block key={i} block={b} onLink={onLink} onAction={onAction} styles={styles} />
      ))}
    </>
  );
}

const makeStyles = (c: Palette) => ({
  body: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 21 as const },
  step: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  stepNum: {
    width: 22 as const,
    height: 22 as const,
    borderRadius: 11 as const,
    backgroundColor: c.primary + "33",
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  stepNumText: { color: c.primary, fontWeight: "700" as const, fontSize: typography.sizeXs },
  stepText: { flex: 1 as const, fontSize: typography.sizeSm, color: c.text, lineHeight: 21 as const },
  linkBtn: { alignSelf: "flex-start" as const },
  linkBtnText: { color: c.primary, fontWeight: "700" as const, fontSize: typography.sizeSm },
  actionBtn: {
    alignSelf: "flex-start" as const,
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
  def: { gap: 2 as const },
  defTerm: { fontSize: typography.sizeSm, fontWeight: "700" as const, color: c.text },
  defText: { fontSize: typography.sizeSm, color: c.textSecondary, lineHeight: 20 as const },
});
