import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { DEFAULT_PROVIDER_ID, PROVIDERS, providerInfo } from "@/constants/providers";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { HelpButton } from "@/components/HelpButton";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { loadDefaultParams, saveDefaultParams } from "@/storage/settingsStore";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";
import { useFontMode } from "@/state/fontMode";

export default function SettingsScreen() {
  const router = useRouter();
  const { status: authStatus, session } = useAuth();
  const { dyslexic, setDyslexic } = useFontMode();
  const [draftKey, setDraftKey] = useState("");
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  // Which provider's BYOK key the section is managing (Phase 3b).
  const [keyProvider, setKeyProvider] = useState(DEFAULT_PROVIDER_ID);

  // Load the saved key for the selected provider whenever it changes; clear the
  // draft so a half-typed key doesn't carry across providers.
  useEffect(() => {
    setDraftKey("");
    setSavedMask(null);
    loadApiKey(keyProvider).then((key) => {
      if (key) setSavedMask(maskApiKey(key, keyProvider));
    });
  }, [keyProvider]);

  useEffect(() => {
    loadDefaultParams().then(setParams);
  }, []);

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
    } finally {
      setSaving(false);
    }
  }, [draftKey, keyProvider]);

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
          },
        },
      ],
    );
  }, [keyProvider]);

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

      {authStatus !== "unavailable" && (
        <Pressable
          style={styles.accountRow}
          onPress={() => router.push(authStatus === "signed_in" ? "/account" : "/sign-in")}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.accountTitle}>Account</Text>
            <Text style={styles.accountSub}>
              {authStatus === "signed_in"
                ? (session?.user?.email ?? "Signed in")
                : "Sign in to sync across devices"}
            </Text>
          </View>
          <Text style={styles.accountChevron}>›</Text>
        </Pressable>
      )}

      <Pressable style={styles.accountRow} onPress={() => router.push("/usage")}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountTitle}>Usage</Text>
          <Text style={styles.accountSub}>Tokens & estimated cost (observed, not billed)</Text>
        </View>
        <Text style={styles.accountChevron}>›</Text>
      </Pressable>

      <View style={styles.labelRow}>
        <Text style={styles.sectionLabel}>API keys (BYOK)</Text>
        <HelpButton topic="byok" label="BYOK" />
      </View>
      <Text style={styles.helpText}>
        Bring your own key per provider. Keys are stored in the Android Keystore
        and sent directly to this app's backend, which calls the provider on your
        behalf. They are never logged or stored on any server.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.providerRow}>
        {PROVIDERS.map((p) => {
          const selected = p.id === keyProvider;
          return (
            <Pressable
              key={p.id}
              onPress={() => setKeyProvider(p.id)}
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

      <Text style={styles.sectionLabel}>Accessibility</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleText}>
          <Text style={styles.toggleTitle}>Dyslexia-friendly font</Text>
          <Text style={styles.helpText}>
            Use the OpenDyslexic typeface across the app. Weighted letter bottoms
            help reduce letter swapping.
          </Text>
        </View>
        <Switch
          value={dyslexic}
          onValueChange={setDyslexic}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.white}
          accessibilityLabel="Toggle dyslexia-friendly font"
        />
      </View>

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
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  accountTitle: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  accountSub: { color: colors.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  accountChevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  // Provider selector for the BYOK key section — same beveled white/yellow as the
  // param chips (selected = yellow, unselected = white; black glyphs).
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  toggleText: { flex: 1 },
  toggleTitle: {
    fontSize: typography.sizeMd,
    color: colors.text,
    fontWeight: "600",
    marginBottom: 2,
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
