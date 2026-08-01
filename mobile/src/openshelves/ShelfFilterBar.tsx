// Inline catalog filter (ADR-028 §6b). Presentational: language chips (the subtags
// actually present + "All") and a Hide-mature toggle. The screen owns persistence.
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { primarySubtag, type ShelfPrefs } from "./filterEntries";
import type { FeedEntry } from "./types";

interface Props {
  entries: FeedEntry[];
  prefs: ShelfPrefs;
  onChange: (p: ShelfPrefs) => void;
}

export function ShelfFilterBar({ entries, prefs, onChange }: Props) {
  const styles = useThemedStyles(makeStyles);
  const langSet = new Set(
    entries.map((e) => (e.language ? primarySubtag(e.language) : null)).filter((l): l is string => !!l),
  );
  // Always render the active pref as a chip, even if the current frame has
  // zero entries in that language (e.g. drilling from a "fr" root pref into
  // an all-English sub-feed). Without this the selected chip silently
  // vanishes: the list correctly empties out, but nothing on screen shows a
  // filter is active or lets the user recover except the always-present
  // "all" chip — it reads as a bug, not a filtered-to-zero result.
  if (prefs.language !== "all") langSet.add(prefs.language);
  const langs = Array.from(langSet).sort();
  const choices: string[] = ["all", ...langs];

  return (
    <View style={styles.bar}>
      <View style={styles.chips}>
        {choices.map((lang) => {
          const selected = prefs.language === lang;
          return (
            <Pressable
              key={lang}
              testID={`lang-${lang}`}
              style={[styles.chip, selected && styles.chipOn]}
              onPress={() => onChange({ ...prefs, language: lang })}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{lang === "all" ? "All" : lang.toUpperCase()}</Text>
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

const makeStyles = (c: Palette) => ({
  bar: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.textMuted, fontSize: typography.sizeSm },
  chipTextOn: { color: c.primaryText, fontWeight: "600" as const },
  toggle: { alignSelf: "flex-start" as const },
  toggleText: { color: c.text, fontSize: typography.sizeSm },
});
