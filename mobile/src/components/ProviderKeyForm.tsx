import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "@/lib/alert";
import {
  deleteApiKey,
  isValidApiKey,
  loadApiKey,
  maskApiKey,
  saveApiKey,
} from "@/secure/keyStore";
import { HelpHint } from "@/components/HelpHint";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { DEFAULT_PROVIDER_ID, PROVIDERS, providerInfo } from "@/constants/providers";

// Per-provider BYOK key management, extracted from the Settings screen so the
// same control can be reused inside the first-run wizard (KeyStep). It owns the
// selected provider plus the saved/draft key state; hosts can react to saves via
// `onSaved` (e.g. the wizard advancing or recording credential metadata).
export interface ProviderKeyFormProps {
  initialProvider?: string;
  onSaved?: (provider: string) => void;
  onCleared?: (provider: string) => void;
  onProviderChange?: (provider: string) => void;
}

export function ProviderKeyForm({
  initialProvider = DEFAULT_PROVIDER_ID,
  onSaved,
  onCleared,
  onProviderChange,
}: ProviderKeyFormProps) {
  const [keyProvider, setKeyProvider] = useState(initialProvider);
  const [draftKey, setDraftKey] = useState("");
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the saved key for the selected provider whenever it changes; clear the
  // draft so a half-typed key doesn't carry across providers.
  useEffect(() => {
    setDraftKey("");
    setSavedMask(null);
    loadApiKey(keyProvider).then((key) => {
      if (key) setSavedMask(maskApiKey(key, keyProvider));
    });
  }, [keyProvider]);

  const selectProvider = useCallback(
    (id: string) => {
      setKeyProvider(id);
      onProviderChange?.(id);
    },
    [onProviderChange],
  );

  const handleSave = useCallback(async () => {
    const trimmed = draftKey.trim();
    const info = providerInfo(keyProvider);
    if (!isValidApiKey(trimmed, keyProvider)) {
      Alert.alert(
        "Invalid key",
        `${info.label} keys start with ${info.keyPrefix} and are at least 20 characters.`,
      );
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(trimmed, keyProvider);
      setSavedMask(maskApiKey(trimmed, keyProvider));
      setDraftKey("");
      onSaved?.(keyProvider);
    } finally {
      setSaving(false);
    }
  }, [draftKey, keyProvider, onSaved]);

  const handleClear = useCallback(() => {
    Alert.alert(
      "Remove API key",
      "You will need to paste it again to generate with this provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteApiKey(keyProvider);
            setSavedMask(null);
            onCleared?.(keyProvider);
          },
        },
      ],
    );
  }, [keyProvider, onCleared]);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.providerRow}
      >
        {PROVIDERS.map((p) => {
          const selected = p.id === keyProvider;
          return (
            <Pressable
              key={p.id}
              onPress={() => selectProvider(p.id)}
              style={[styles.providerChip, selected && styles.providerChipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`Manage ${p.label} key`}
            >
              <Text style={[styles.providerChipText, selected && styles.providerChipTextSelected]}>
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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

      <View style={styles.keyLabelRow}>
        <Text style={styles.keyLabel}>API key</Text>
        <HelpHint
          label="API key"
          text="Stored only in this device's secure storage. It travels with each generation request and is used once to call the provider, then discarded — never logged or saved on our servers."
        />
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.keyInput}
          placeholder={providerInfo(keyProvider).keyHint}
          placeholderTextColor={colors.textMuted}
          value={draftKey}
          onChangeText={setDraftKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel={`Paste ${providerInfo(keyProvider).label} API key`}
        />
        <Pressable
          style={[styles.saveBtn, (!draftKey.trim() || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!draftKey.trim() || saving}
          accessibilityRole="button"
          accessibilityLabel="Save API key"
          accessibilityState={{ disabled: !draftKey.trim() || saving }}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Provider selector — same beveled white/brand tiles as the param chips
  // (selected = brand face, unselected = white; dark glyphs).
  providerRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  providerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.tileOffFace,
    borderWidth: 2,
    borderTopColor: colors.tileOffFace,
    borderLeftColor: colors.tileOffFace,
    borderBottomColor: colors.tileOffShadow,
    borderRightColor: colors.tileOffShadow,
  },
  providerChipSelected: {
    backgroundColor: colors.tileOnFace,
    borderTopColor: colors.tileOnLo,
    borderLeftColor: colors.tileOnLo,
    borderBottomColor: colors.tileOnHi,
    borderRightColor: colors.tileOnHi,
  },
  providerChipText: { fontSize: typography.sizeSm, fontWeight: "600", color: colors.tileOffGlyph },
  providerChipTextSelected: { color: colors.tileOnGlyph },
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
  savedKeyRow: { flex: 1 },
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
  clearBtnText: { color: colors.error, fontSize: typography.sizeSm, fontWeight: "600" },
  noKeyText: { fontSize: typography.sizeSm, color: colors.textMuted, fontStyle: "italic" },
  keyLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  keyLabel: { fontSize: typography.sizeSm, fontWeight: "600", color: colors.textSecondary },
  inputRow: { flexDirection: "row", gap: spacing.sm },
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
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
});
