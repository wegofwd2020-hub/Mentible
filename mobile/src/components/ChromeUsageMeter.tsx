import React, { useCallback, useState } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { UsageMeterPill } from "@/components/UsageMeterPill";
import { providerInfo } from "@/constants/providers";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useManagedStatus } from "@/hooks/useManagedStatus";
import { loadDefaultParams } from "@/storage/settingsStore";
import { listUsage, summarizeUsage } from "@/storage/usageStore";
import { useThemedStyles } from "@/theme";

// Always-on "what engine am I using, and how much have I spent" chip for the app
// chrome (TopNavBar + SideNav). Unlike the old managed-only meter, this shows for
// EVERYONE — the #1 wayfinding gap from the Groq-vs-Anthropic saga was that a user
// couldn't see which engine was actually running. Shows:
//   • the active engine (the selected default provider), always;
//   • managed users → the $ allowance meter (UsageMeterPill);
//   • BYOK / anonymous → this device's token count (the local usage ledger).
// Tapping opens the full Usage screen. Refreshes on focus so a Settings change to
// the engine, or a fresh generation, shows up when the user returns to a screen.

const SHORT_ENGINE: Record<string, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  groq: "Groq",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

function shortEngine(providerId: string): string {
  return SHORT_ENGINE[providerId] ?? providerInfo(providerId).label;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ChromeUsageMeter({
  style,
}: {
  style?: StyleProp<ViewStyle>;
} = {}): React.JSX.Element {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { status } = useManagedStatus();
  const [engine, setEngine] = useState<string>("");
  const [deviceTokens, setDeviceTokens] = useState(0);

  const reload = useCallback(() => {
    let active = true;
    void (async () => {
      try {
        const params = await loadDefaultParams();
        if (active) setEngine(shortEngine(params.provider));
      } catch {
        // non-critical chrome — leave the engine label blank on a read failure
      }
      try {
        const s = summarizeUsage(await listUsage());
        if (active) setDeviceTokens(s.totalInputTokens + s.totalOutputTokens);
      } catch {
        // ignore — device ledger is best-effort here
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(reload);

  const managed = status?.entitlement != null;

  return (
    <Pressable
      onPress={() => router.push("/usage")}
      accessibilityRole="button"
      accessibilityLabel={`Engine ${engine || "unknown"} — open usage`}
      style={[styles.row, style]}
    >
      <View style={styles.enginePill}>
        <Text style={styles.engineText} numberOfLines={1}>
          ⚙ {engine || "…"}
        </Text>
      </View>
      {managed && status ? (
        <UsageMeterPill status={status} />
      ) : (
        <Text style={styles.tokens}>{formatTokens(deviceTokens)} tok</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    flexShrink: 1,
  },
  enginePill: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 1,
  },
  engineText: { color: c.textSecondary, fontSize: typography.sizeXs, fontWeight: "600" as const },
  tokens: { color: c.textMuted, fontSize: typography.sizeXs },
});
