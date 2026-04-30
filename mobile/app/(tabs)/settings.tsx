import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  deleteApiKey,
  isValidApiKey,
  loadApiKey,
  maskApiKey,
  saveApiKey,
} from "@/secure/keyStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function SettingsScreen() {
  const [draftKey, setDraftKey] = useState("");
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadApiKey().then((key) => {
      if (key) setSavedMask(maskApiKey(key));
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = draftKey.trim();
    if (!isValidApiKey(trimmed)) {
      Alert.alert(
        "Invalid key",
        "Anthropic API keys start with sk-ant- and are at least 20 characters.",
      );
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(trimmed);
      setSavedMask(maskApiKey(trimmed));
      setDraftKey("");
    } finally {
      setSaving(false);
    }
  }, [draftKey]);

  const handleClear = useCallback(() => {
    Alert.alert(
      "Remove API key",
      "You will need to paste it again to generate lessons.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteApiKey();
            setSavedMask(null);
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Anthropic API key</Text>
      <Text style={styles.helpText}>
        Your key is stored in the Android Keystore and sent directly to this
        app's backend, which calls Anthropic on your behalf. It is never logged
        or stored on any server.
      </Text>

      {savedMask ? (
        <View style={styles.savedKeyCard}>
          <View style={styles.savedKeyRow}>
            <Text style={styles.savedKeyLabel}>Saved key</Text>
            <Text style={styles.savedKeyMask}>{savedMask}</Text>
          </View>
          <Pressable
            style={styles.clearBtn}
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Remove saved API key"
          >
            <Text style={styles.clearBtnText}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.noKeyText}>No key saved</Text>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.keyInput}
          placeholder="sk-ant-..."
          placeholderTextColor={colors.textMuted}
          value={draftKey}
          onChangeText={setDraftKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel="Paste Anthropic API key"
        />
        <Pressable
          style={[
            styles.saveBtn,
            (!draftKey.trim() || saving) && styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={!draftKey.trim() || saving}
          accessibilityRole="button"
          accessibilityLabel="Save API key"
          accessibilityState={{ disabled: !draftKey.trim() || saving }}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>About</Text>
      <View style={styles.aboutCard}>
        <AboutRow label="App" value="StudyBuddy Q" />
        <AboutRow label="Version" value="0.1.0 (MVP)" />
        <AboutRow label="Key model" value="claude-sonnet-4-6" />
      </View>
    </ScrollView>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={styles.aboutValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: typography.sizeXs,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  helpText: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  savedKeyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  savedKeyRow: {
    flex: 1,
  },
  savedKeyLabel: {
    fontSize: typography.sizeXs,
    color: colors.textMuted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  savedKeyMask: {
    fontSize: typography.sizeMd,
    color: colors.text,
    fontFamily: "monospace",
    marginTop: 4,
  },
  clearBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error + "66",
  },
  clearBtnText: {
    color: colors.error,
    fontSize: typography.sizeSm,
    fontWeight: "600",
  },
  noKeyText: {
    fontSize: typography.sizeSm,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  keyInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: typography.sizeMd,
    fontFamily: "monospace",
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: colors.primaryText,
    fontWeight: "700",
    fontSize: typography.sizeSm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  aboutCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  aboutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  aboutLabel: {
    fontSize: typography.sizeSm,
    color: colors.textSecondary,
  },
  aboutValue: {
    fontSize: typography.sizeSm,
    color: colors.text,
    fontWeight: "500",
  },
});
