// mobile/src/openshelves/AddSourceForm.tsx
// Presentational: collect a feed URL + surface parent-owned error/busy. No store,
// no network, no alert — the screen owns add + the P0-8 warning confirm.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

interface Props {
  onSubmit: (url: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function AddSourceForm({ onSubmit, busy, error }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [url, setUrl] = useState("");
  const submit = () => {
    const trimmed = url.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <View style={styles.wrap}>
      <TextInput
        testID="add-source-input"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://…  (an OPDS catalog URL)"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
      />
      <Pressable testID="add-source-submit" style={styles.button} onPress={submit} disabled={busy}>
        <Text style={styles.buttonText}>Add source</Text>
      </Pressable>
      <Text style={styles.warning}>
        Libraries you add are outside Mentible's curation — using them is your responsibility.
      </Text>
      {error ? (
        <Text testID="add-source-error" style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { gap: spacing.sm },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: c.text, fontSize: typography.sizeMd,
  },
  button: {
    backgroundColor: c.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center" as const,
  },
  buttonText: { color: c.primaryText, fontSize: typography.sizeMd, fontWeight: "600" as const },
  warning: { color: c.textMuted, fontSize: typography.sizeXs },
  error: { color: c.error, fontSize: typography.sizeXs },
});
