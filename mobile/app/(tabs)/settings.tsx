import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { HelpButton } from "@/components/HelpButton";
import { PageContainer } from "@/components/PageContainer";
import { ProviderKeyForm } from "@/components/ProviderKeyForm";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import { loadDefaultParams, saveDefaultParams } from "@/storage/settingsStore";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";
import { useFontMode } from "@/state/fontMode";
import { IS_DEMO } from "@/constants/demo";

export default function SettingsScreen() {
  const router = useRouter();
  const { status: authStatus, session } = useAuth();
  const { dyslexic, setDyslexic } = useFontMode();
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);

  useEffect(() => {
    loadDefaultParams().then(setParams);
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
      {IS_DEMO && (
        <View style={styles.demoNote}>
          <Text style={styles.demoNoteText}>
            Demo build — read the included books freely. Authoring, content
            generation, and accounts are disabled in the demo.
          </Text>
        </View>
      )}
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

      {!IS_DEMO && (
      <>
      <Pressable style={styles.accountRow} onPress={() => router.push("/usage")}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountTitle}>Usage</Text>
          <Text style={styles.accountSub}>Tokens & estimated cost (observed, not billed)</Text>
        </View>
        <Text style={styles.accountChevron}>›</Text>
      </Pressable>

      <View style={styles.labelRow}>
        <Text style={styles.sectionLabel}>API keys (BYOK)</Text>
        <HelpButton topic="provider-keys" label="BYOK" />
      </View>
      <Text style={styles.helpText}>
        Bring your own key per provider. Keys are stored in the Android Keystore
        and sent directly to this app's backend, which calls the provider on your
        behalf. They are never logged or stored on any server.
      </Text>

      <RequireSignIn action="add your API keys">
        <ProviderKeyForm />
      </RequireSignIn>

      <View style={styles.divider} />

      <Text style={styles.sectionLabel}>Generation defaults</Text>
      <Text style={styles.helpText}>
        Defaults for new books and one-off lessons. Each book keeps its own copy
        you can adjust per book.
      </Text>
      <GenerationParamsEditor value={params} onChange={handleParamsChange} />
      </>
      )}

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

      {!IS_DEMO && (
      <>
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
      </>
      )}
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
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  demoNote: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  demoNoteText: { color: colors.textSecondary, fontSize: typography.sizeSm, lineHeight: 20 },
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
