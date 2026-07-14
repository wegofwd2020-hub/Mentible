// Inline catalog filter (ADR-028 §6b). Presentational: language chips (the subtags
// actually present + "All") and a Hide-mature toggle. The screen owns persistence.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { primarySubtag, type ShelfPrefs } from "./filterEntries";
import type { FeedEntry } from "./types";

interface Props {
  entries: FeedEntry[];
  prefs: ShelfPrefs;
  onChange: (p: ShelfPrefs) => void;
}

export function ShelfFilterBar({ entries, prefs, onChange }: Props) {
  const langs = Array.from(
    new Set(entries.map((e) => (e.language ? primarySubtag(e.language) : null)).filter((l): l is string => !!l)),
  ).sort();
  const choices: string[] = ["all", ...langs];

  return (
    <View style={styles.bar}>
      <View style={styles.chips}>
        {choices.map((c) => {
          const selected = prefs.language === c;
          return (
            <Pressable
              key={c}
              testID={`lang-${c}`}
              style={[styles.chip, selected && styles.chipOn]}
              onPress={() => onChange({ ...prefs, language: c })}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{c === "all" ? "All" : c.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable testID="toggle-mature" style={styles.toggle} onPress={() => onChange({ ...prefs, hideMature: !prefs.hideMature })}>
        <Text style={styles.toggleText}>{prefs.hideMature ? "☑ Hide mature" : "☐ Hide mature"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: typography.sizeSm },
  chipTextOn: { color: colors.primaryText, fontWeight: "600" },
  toggle: { alignSelf: "flex-start" },
  toggleText: { color: colors.text, fontSize: typography.sizeSm },
});
