import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
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
import { useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { HelpButton } from "@/components/HelpButton";
import { PageContainer } from "@/components/PageContainer";
import { loadDefaultParams, saveDefaultParams } from "@/storage/settingsStore";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";

export default function SettingsScreen() {
  const router = useRouter();
  const [draftKey, setDraftKey] = useState("");
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);

  useEffect(() => {
    loadApiKey().then((key) => {
      if (key) setSavedMask(maskApiKey(key));
    });
    loadDefaultParams().then(setParams);
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

  // Persist the global default immediately on each change.
  const handleParamsChange = useCallback((next: GenerationParams) => {
    setParams(next);
    void saveDefaultParams(next);
  }, []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
      <View style={styles.brandHeader}>
        <View style={styles.brandCard}>
          <Image
            source={require("../../assets/brand/mentible-lockup-redorange-white.png")}
            style={styles.brandLogo}
            resizeMode="contain"
            accessibilityLabel="Mentible — Author Yourself"
          />
        </View>
      </View>

      <View style={styles.labelRow}>
        <Text style={styles.sectionLabel}>Anthropic API key</Text>
        <HelpButton topic="byok" label="BYOK" />
      </View>
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

      <Text style={styles.sectionLabel}>Generation defaults</Text>
      <Text style={styles.helpText}>
        Defaults for new books and one-off lessons. Each book keeps its own copy
        you can adjust per book.
      </Text>
      <GenerationParamsEditor value={params} onChange={handleParamsChange} />

      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>Prototypes</Text>
      <Pressable
        style={styles.protoRow}
        onPress={() => router.push("/concepts")}
        accessibilityRole="button"
        accessibilityLabel="Open UI concept gallery"
      >
        <Text style={styles.protoText}>🎨 UI concept gallery</Text>
        <Text style={styles.protoChevron}>→</Text>
      </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // Brand lockup sits on a light card (the mark is designed for light backdrops),
  // shrink-wrapped and centered above the settings content.
  brandHeader: {
    alignItems: "center",
    paddingTop: spacing.sm,
  },
  brandCard: {
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandLogo: {
    width: 132,
    height: 132,
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
  protoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  protoText: {
    fontSize: typography.sizeMd,
    color: colors.text,
    fontWeight: "600",
  },
  protoChevron: {
    fontSize: typography.sizeMd,
    color: colors.primary,
  },
});
