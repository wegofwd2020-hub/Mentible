import React, { useCallback, useState } from "react";
import { Pressable, Text, type StyleProp, type ViewStyle } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { providerInfo } from "@/constants/providers";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { loadDefaultParams } from "@/storage/settingsStore";
import { listUsage, summarizeUsage } from "@/storage/usageStore";
import { useThemedStyles } from "@/theme";

// A LIGHT engine + device-token badge for screens OUTSIDE the tab chrome — chiefly
// the trust Project screen, where the user actually generates and most needs to see
// which engine is active. Deliberately does NOT pull useManagedStatus/useAuth (that
// chain is what the full ChromeUsageMeter needs, and forcing it onto this heavily
// tested screen broke its render); it reads only the selected engine + the local
// token ledger, both auth-free. Tap → the Usage screen for the full picture.

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

export function EngineBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const [engine, setEngine] = useState<string>("");
  const [tokens, setTokens] = useState(0);

  const reload = useCallback(() => {
    let active = true;
    void (async () => {
      try {
        const params = await loadDefaultParams();
        if (active) setEngine(shortEngine(params.provider));
      } catch {
        // non-critical — leave blank on a read failure
      }
      try {
        const s = summarizeUsage(await listUsage());
        if (active) setTokens(s.totalInputTokens + s.totalOutputTokens);
      } catch {
        // ignore — best-effort
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(reload);

  return (
    <Pressable
      onPress={() => router.push("/usage")}
      accessibilityRole="button"
      accessibilityLabel={`Engine ${engine || "unknown"} — open usage`}
      style={[styles.badge, style]}
    >
      <Text style={styles.text} numberOfLines={1}>
        ⚙ {engine || "…"}
        {tokens > 0 ? ` · ${formatTokens(tokens)} tok` : ""}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) => ({
  badge: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 1,
  },
  text: { color: c.textSecondary, fontSize: typography.sizeXs, fontWeight: "600" as const },
});
