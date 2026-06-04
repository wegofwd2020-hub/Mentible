import React, { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface Example {
  name: string;
  use: string;
  img: ImageSourcePropType;
}
interface RegisterGroup {
  key: string;
  label: string;
  blurb: string;
  examples: Example[];
}

// Diagram examples grouped by the diagram REGISTER (matches the "Diagrams"
// picker in generation params). Reference-only: tap an example to enlarge.
const REGISTERS: RegisterGroup[] = [
  {
    key: "conceptual",
    label: "Conceptual",
    blurb:
      "Big-idea infographics for an overview or non-technical audience — intuition over implementation detail.",
    examples: [
      {
        name: "Mindmap",
        use: "A central topic with branches for its parts.",
        img: require("../assets/diagrams/mindmap.png"),
      },
      {
        name: "Radial · hub-and-spoke",
        use: "Several contributors pointing at one outcome.",
        img: require("../assets/diagrams/radial.png"),
      },
      {
        name: "Funnel · stage flow",
        use: "A few big ideas in sequence or stages.",
        img: require("../assets/diagrams/funnel.png"),
      },
      {
        name: "Quadrant",
        use: "Two axes splitting a space into four.",
        img: require("../assets/diagrams/quadrant.png"),
      },
    ],
  },
  {
    key: "balanced",
    label: "Balanced (default)",
    blurb:
      "Focused flowcharts — and the occasional sequence — with real logic in plain language. The default.",
    examples: [
      {
        name: "Flowchart",
        use: "Steps, decisions and loops in a process.",
        img: require("../assets/diagrams/flowchart.png"),
      },
      {
        name: "Sequence",
        use: "Who calls whom, over time.",
        img: require("../assets/diagrams/sequence.png"),
      },
    ],
  },
  {
    key: "technical",
    label: "Technical",
    blurb:
      "Precise diagrams for a reference / engineer audience — the exact type that fits the content.",
    examples: [
      {
        name: "Flowchart",
        use: "Decision logic with all the real branches.",
        img: require("../assets/diagrams/flowchart.png"),
      },
      {
        name: "Sequence",
        use: "Interactions over time (sync vs async).",
        img: require("../assets/diagrams/sequence.png"),
      },
      {
        name: "State",
        use: "The states one thing moves through (lifecycle).",
        img: require("../assets/diagrams/state.png"),
      },
      {
        name: "Architecture",
        use: "Components and their boundaries.",
        img: require("../assets/diagrams/architecture.png"),
      },
    ],
  },
];

export default function DiagramTypesScreen() {
  const [zoom, setZoom] = useState<ImageSourcePropType | null>(null);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <Text style={styles.intro}>
          When you generate, Mentible picks diagrams to match your chosen{" "}
          <Text style={styles.bold}>Diagrams</Text> register. Here&apos;s what each
          register produces — tap any example to enlarge.
        </Text>

        {REGISTERS.map((g) => (
          <View key={g.key} style={styles.group}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            <Text style={styles.groupBlurb}>{g.blurb}</Text>
            {g.examples.map((ex) => (
              <Pressable
                key={g.key + ex.name}
                style={styles.card}
                onPress={() => setZoom(ex.img)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${ex.name} — ${ex.use}. Tap to enlarge.`}
              >
                <View style={styles.imageWrap}>
                  <Image source={ex.img} style={styles.image} resizeMode="contain" />
                </View>
                <Text style={styles.exName}>{ex.name}</Text>
                <Text style={styles.exUse}>{ex.use}</Text>
              </Pressable>
            ))}
          </View>
        ))}

        <Text style={styles.footnote}>
          Set the register under “Diagrams” on the Query screen, or in Settings for
          new books. Any chapter can still ask for a specific diagram via its
          enhancement instructions.
        </Text>
      </PageContainer>

      <Modal visible={zoom !== null} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={styles.lightbox} onPress={() => setZoom(null)} accessibilityLabel="Close">
          {zoom && <Image source={zoom} style={styles.lightboxImage} resizeMode="contain" />}
          <Text style={styles.lightboxHint}>Tap to close</Text>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  intro: { fontSize: typography.sizeSm, color: colors.textSecondary, lineHeight: 21 },
  bold: { fontWeight: "700", color: colors.text },
  group: { gap: spacing.xs, marginTop: spacing.sm },
  groupLabel: {
    fontSize: typography.sizeMd,
    fontWeight: "800",
    color: colors.primary,
  },
  groupBlurb: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  // Diagrams render on white, so sit them on a white tile inside the dark card.
  imageWrap: {
    backgroundColor: "#ffffff",
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: "center",
  },
  image: { width: "100%", height: 180 },
  exName: {
    fontSize: typography.sizeSm,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.sm,
  },
  exUse: { fontSize: typography.sizeXs, color: colors.textMuted, marginTop: 2 },
  footnote: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  lightbox: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.md,
  },
  lightboxImage: { width: "100%", height: "82%", backgroundColor: "#ffffff", borderRadius: radius.md },
  lightboxHint: { color: "#cbd5e1", fontSize: typography.sizeSm, marginTop: spacing.md },
});
