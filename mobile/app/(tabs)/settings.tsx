import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { radius, spacing, typography, THEME_META, themes, SWITCHABLE_THEMES, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles, useThemeControls } from "@/theme";
import { GenerationParamsEditor } from "@/components/GenerationParamsEditor";
import { HelpButton } from "@/help";
import { PageContainer } from "@/components/PageContainer";
import { ProviderKeyForm } from "@/components/ProviderKeyForm";
import { BackupRestore } from "@/components/BackupRestore";
import { LibrarySync } from "@/components/LibrarySync";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import { loadDefaultParams, saveDefaultParams, loadSettingsTab, saveSettingsTab } from "@/storage/settingsStore";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";
import { useFontMode } from "@/state/fontMode";
import { IS_DEMO } from "@/constants/demo";
import { Card, Label } from "@/components/ui";

// Settings is grouped into tabs (dogfeedback #544 — one long full-width page
// was hard to scan). Each tab holds 1–3 of the existing sections, unchanged.
type TabKey = "source" | "looks" | "account" | "data";
const TAB_META: { key: TabKey; label: string }[] = [
  { key: "source", label: "Tune the source" },
  { key: "looks", label: "Looks" },
  { key: "account", label: "Account" },
  { key: "data", label: "Data" },
];
// Most non-Looks sections are !IS_DEMO-gated, so in the demo only Looks has
// content — offer just the populated tab there (no empty panes).
const VISIBLE_TABS: TabKey[] = IS_DEMO ? ["looks"] : ["source", "looks", "account", "data"];

export default function SettingsScreen() {
  const router = useRouter();
  const { status: authStatus, session } = useAuth();
  const { dyslexic, setDyslexic } = useFontMode();
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  const [tab, setTab] = useState<TabKey>(VISIBLE_TABS[0]);
  const c = useTheme();
  const { themeName, setTheme } = useThemeControls();
  const styles = useThemedStyles(makeStyles);
  const THEME_NAMES = SWITCHABLE_THEMES;

  useEffect(() => {
    loadDefaultParams().then(setParams);
  }, []);

  // Restore the last-opened tab (best-effort), but only if it is still a
  // visible tab in this build (e.g. a persisted "data" is invalid in demo).
  useEffect(() => {
    loadSettingsTab().then((saved) => {
      if (saved && (VISIBLE_TABS as string[]).includes(saved)) setTab(saved as TabKey);
    });
  }, []);

  const selectTab = useCallback((next: TabKey) => {
    setTab(next);
    void saveSettingsTab(next);
  }, []);

  // Persist the global default immediately on each change.
  const handleParamsChange = useCallback((next: GenerationParams) => {
    setParams(next);
    void saveDefaultParams(next);
  }, []);

  const appearanceSection = (
    <>
      <Label tone="secondary">Appearance</Label>
      <Text style={styles.helpText}>
        Pick a colour theme. It applies instantly across the app and is saved on
        this device. Your book exports are not affected.
      </Text>
      {/* Wrap (not horizontal-scroll) so every theme — including the last ones
          like Navy Trust — is visible without scrolling. */}
      <View style={styles.swatchRow}>
        {THEME_NAMES.map((name) => {
          const p = themes[name];
          const active = name === themeName;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Theme: ${THEME_META[name].label}${active ? " (selected)" : ""}`}
              onPress={() => setTheme(name)}
              style={[styles.swatch, { backgroundColor: p.background, borderColor: active ? p.primary : p.border }]}
            >
              <Text style={[styles.swatchSample, { color: p.text }]}>Aa</Text>
              <View style={[styles.swatchDot, { backgroundColor: p.primary }]} />
              <Text style={[styles.swatchLabel, { color: p.textSecondary }]}>{THEME_META[name].label}</Text>
              {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </>
  );

  const accessibilitySection = (
    <>
      <Label tone="secondary">Accessibility</Label>
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
          trackColor={{ false: c.border, true: c.primary }}
          thumbColor={c.white}
          accessibilityLabel="Toggle dyslexia-friendly font"
        />
      </View>
    </>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <PageContainer>
      {IS_DEMO && (
        <Card style={styles.demoNote}>
          <Text style={styles.demoNoteText}>
            Demo build — read the included books freely. Authoring, content
            generation, and accounts are disabled in the demo.
          </Text>
        </Card>
      )}

      {/* Tab bar — swaps the visible section group, no navigation. Rendered only
          when more than one tab has content (in demo there is just Looks). */}
      {VISIBLE_TABS.length > 1 && (
        <View style={styles.tabBar}>
          {TAB_META.filter((t) => (VISIBLE_TABS as string[]).includes(t.key)).map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Settings section: ${t.label}`}
                style={[styles.tabBtn, active ? styles.tabBtnActive : null]}
                onPress={() => selectTab(t.key)}
              >
                <Text style={active ? styles.tabTextActive : styles.tabText}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Tune the source — the knobs on content-generation source & quality. */}
      {!IS_DEMO && tab === "source" && (
        <>
          <View style={styles.labelRow}>
            <Label tone="secondary">API keys (BYOK)</Label>
            <HelpButton topic="provider-keys" label="BYOK" />
          </View>
          <Text style={styles.helpText}>
            Bring your own key per provider. Keys are stored in your device's secure storage
            and sent directly to this app's backend, which calls the provider on your
            behalf. They are never logged or stored on any server.
          </Text>
          <RequireSignIn action="add your API keys">
            <ProviderKeyForm />
          </RequireSignIn>

          <View style={styles.divider} />

          <Label tone="secondary">Generation defaults</Label>
          <Text style={styles.helpText}>
            Defaults for new books and one-off lessons. Each book keeps its own copy
            you can adjust per book.
          </Text>
          <GenerationParamsEditor value={params} onChange={handleParamsChange} />
        </>
      )}

      {/* Looks — themes + reading accessibility. Always available (incl. demo). */}
      {tab === "looks" && (
        <>
          {appearanceSection}
          <View style={styles.divider} />
          {accessibilitySection}
        </>
      )}

      {/* Account — identity, plan, consumption. */}
      {!IS_DEMO && tab === "account" && (
        <>
          {authStatus !== "unavailable" && (
            <Pressable onPress={() => router.push(authStatus === "signed_in" ? "/account" : "/sign-in")}>
              <Card style={styles.accountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountTitle}>Account</Text>
                  <Text style={styles.accountSub}>
                    {authStatus === "signed_in"
                      ? (session?.user?.email ?? "Signed in")
                      : "Sign in to sync across devices"}
                  </Text>
                </View>
                <Text style={styles.accountChevron}>›</Text>
              </Card>
            </Pressable>
          )}
          <Pressable onPress={() => router.push("/paywall")}>
            <Card style={styles.accountRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountTitle}>Plans & billing</Text>
                <Text style={styles.accountSub}>Managed generation, or bring your own key</Text>
              </View>
              <Text style={styles.accountChevron}>›</Text>
            </Card>
          </Pressable>
          <Pressable onPress={() => router.push("/usage")}>
            <Card style={styles.accountRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountTitle}>Usage</Text>
                <Text style={styles.accountSub}>Tokens & estimated cost (observed, not billed)</Text>
              </View>
              <Text style={styles.accountChevron}>›</Text>
            </Card>
          </Pressable>
        </>
      )}

      {/* Data — device backup, cloud sync, and the concept-gallery prototype. */}
      {!IS_DEMO && tab === "data" && (
        <>
          <BackupRestore />

          <View style={styles.divider} />

          <RequireSignIn action="sync your library">
            <LibrarySync />
          </RequireSignIn>

          <View style={styles.divider} />

          <Label tone="secondary">Prototypes</Label>
          <Pressable
            onPress={() => router.push("/concepts")}
            accessibilityRole="button"
            accessibilityLabel="Open UI concept gallery"
          >
            <Card style={styles.protoRow}>
              <Text style={styles.protoText}>🎨 UI concept gallery</Text>
              <Text style={styles.protoChevron}>→</Text>
            </Card>
          </Pressable>
        </>
      )}
      </PageContainer>
    </ScrollView>
  );
}

function makeStyles(c: Palette) {
  return {
    scroll: {
      flex: 1,
      backgroundColor: "transparent",
    },
    scrollContent: {
      flexGrow: 1,
    },
    labelRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
    // Segmented tab bar — same pill treatment as the trust screen's
    // "Whole book | Per topic" toggle. Wraps so all tabs stay visible on narrow
    // widths instead of overflowing.
    tabBar: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    tabBtn: {
      backgroundColor: c.surfaceHigh,
      borderRadius: radius.sm,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    tabBtnActive: { backgroundColor: c.primary },
    tabText: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
    tabTextActive: { color: c.primaryText, fontSize: typography.sizeSm, fontWeight: "600" as const },
    // Layout only — the surface, border, and padding now come from <Card>,
    // which this style overrides onto (Studio re-skin P2).
    accountRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      marginBottom: spacing.lg,
    },
    accountTitle: { color: c.text, fontSize: typography.sizeMd, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
    accountSub: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
    accountChevron: { color: c.textMuted, fontSize: typography.sizeXl },
    helpText: {
      fontSize: typography.sizeSm,
      color: c.textMuted,
      lineHeight: 20,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.sm,
    },
    // Layout only — the surface, border, and padding now come from <Card>.
    demoNote: {
      marginBottom: spacing.md,
    },
    demoNoteText: { color: c.textSecondary, fontSize: typography.sizeSm, lineHeight: 20 },
    toggleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    toggleText: { flex: 1 },
    toggleTitle: {
      fontSize: typography.sizeMd,
      color: c.text,
      fontFamily: FRAUNCES.semibold,
      letterSpacing: -0.36,
      marginBottom: 2,
    },
    // Layout only — the surface, border, and padding now come from <Card>.
    protoRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
    },
    protoText: {
      fontSize: typography.sizeMd,
      color: c.text,
      fontFamily: FRAUNCES.semibold,
      letterSpacing: -0.36,
    },
    protoChevron: {
      fontSize: typography.sizeMd,
      color: c.primary,
    },
    swatchRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm, paddingVertical: spacing.sm },
    swatch: { width: 92, borderRadius: radius.md, borderWidth: 2, padding: spacing.sm, alignItems: "center" as const, gap: 4 },
    swatchSample: { fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
    swatchDot: { width: 14, height: 14, borderRadius: 7 },
    // Colour is set inline per tile (p.textSecondary) so each caption stays
    // legible on its OWN palette background, not the active theme's.
    swatchLabel: { fontSize: typography.sizeXs, textAlign: "center" as const },
    swatchCheck: { color: c.primary, fontWeight: "500" as const },
  };
}
