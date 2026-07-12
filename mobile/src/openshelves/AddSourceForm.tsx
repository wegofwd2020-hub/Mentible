// mobile/src/openshelves/AddSourceForm.tsx
// Presentational: collect a feed URL + surface parent-owned error/busy. No store,
// no network, no alert — the screen owns add + the P0-8 warning confirm.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface Props {
  onSubmit: (url: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function AddSourceForm({ onSubmit, busy, error }: Props) {
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
        placeholderTextColor={colors.textMuted}
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

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text, fontSize: typography.sizeMd,
  },
  button: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center",
  },
  buttonText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "600" },
  warning: { color: colors.textMuted, fontSize: typography.sizeXs },
  error: { color: colors.error, fontSize: typography.sizeXs },
});
