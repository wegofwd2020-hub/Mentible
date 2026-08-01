import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Alert } from "@/lib/alert";
import {
  deleteApiKey,
  isValidApiKey,
  loadApiKey,
  maskApiKey,
  saveApiKey,
} from "@/secure/keyStore";
import { HelpHint } from "@/help";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) => ({
  // Provider selector — same beveled white/brand tiles as the param chips
  // (selected = brand face, unselected = white; dark glyphs).
  providerRow: { flexDirection: "row" as const, gap: spacing.sm, paddingVertical: spacing.xs },
  providerChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.tileOffFace,
    borderWidth: 2,
    borderTopColor: c.tileOffFace,
    borderLeftColor: c.tileOffFace,
    borderBottomColor: c.tileOffShadow,
    borderRightColor: c.tileOffShadow,
  },
  providerChipSelected: {
    backgroundColor: c.tileOnFace,
    borderTopColor: c.tileOnLo,
    borderLeftColor: c.tileOnLo,
    borderBottomColor: c.tileOnHi,
    borderRightColor: c.tileOnHi,
  },
  providerChipText: { fontSize: typography.sizeSm, fontWeight: "600" as const, color: c.tileOffGlyph },
  providerChipTextSelected: { color: c.tileOnGlyph },
  savedKeyCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  savedKeyRow: { flex: 1 },
  savedKeyLabel: {
    fontSize: typography.sizeXs,
    color: c.textMuted,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  savedKeyMask: {
    fontSize: typography.sizeMd,
    color: c.text,
    fontFamily: "monospace",
    marginTop: 4,
  },
  clearBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: c.error + "66",
  },
  clearBtnText: { color: c.error, fontSize: typography.sizeSm, fontWeight: "600" as const },
  noKeyText: { fontSize: typography.sizeSm, color: c.textMuted, fontStyle: "italic" as const },
  keyLabelRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  keyLabel: { fontSize: typography.sizeSm, fontWeight: "600" as const, color: c.textSecondary },
  inputRow: { flexDirection: "row" as const, gap: spacing.sm },
  keyInput: {
    flex: 1,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: c.text,
    fontSize: typography.sizeMd,
    fontFamily: "monospace",
  },
  saveBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center" as const,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
});
