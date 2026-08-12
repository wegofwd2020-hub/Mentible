import React from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useThemedStyles } from "@/theme";
import { Label } from "@/components/ui";

// Curated per-route kickers (Studio P2). Keyed by route.name; unmapped routes
// fall back to the uppercased screen title so nothing renders blank.
export const SECTION_KICKERS: Record<string, string> = {
  "trust/[projectId]": "PROJECT",
  "trust/new": "NEW PROJECT",
  "trust/version/[versionId]": "DRAFT",
  "trust/topic-version/[id]": "DRAFT",
  "book/new": "NEW BOOK",
  "book/saved/[id]": "EDIT BOOK",
  "book/generate/[id]": "WRITE TOPICS",
  "book/topic/[bookId]/[topicId]": "TOPIC",
  "book/chapter/[bookId]/[chapterId]": "CHAPTER",
  "book/read/[id]": "READ",
  "book/reviews/[id]": "REVIEWS",
  "book/import": "IMPORT",
  "book/shared/[id]": "SHARED BOOK",
  "trust/compare/[versionId]": "COMPARE",
  account: "ACCOUNT",
  usage: "USAGE",
  paywall: "PLANS",
  admin: "ADMIN",
  "admin/[sub]": "USER",
  "sign-in": "SIGN IN",
  concepts: "PROTOTYPE",
  "diagram-types": "DIAGRAM TYPES",
};

export function kickerFor(routeName: string, title?: string): string {
  return SECTION_KICKERS[routeName] ?? (title ?? "").toUpperCase();
}

export function StudioHeader({ navigation, route, options, back }: NativeStackHeaderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const kicker = kickerFor(route.name, options.title);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs }]}>
      {back ? (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backBtn}
        >
          <Text style={styles.chevron}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.backBtn} />
      )}
      <View style={styles.titles}>
        <Text style={styles.wordmark} numberOfLines={1}>MENTIBLE</Text>
        {kicker ? <Label style={styles.kicker}>{kicker}</Label> : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  bar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: c.background,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center" as const, justifyContent: "center" as const },
  chevron: { color: c.text, fontSize: typography.sizeXl },
  titles: { flex: 1 },
  // Playfair wordmark — ≥16px floor honoured (sizeLg=18). Medium weight, never bold.
  wordmark: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.medium, letterSpacing: 1 },
  kicker: { marginTop: 1 }, // <Label> already: uppercase, tracked, muted, 500
});
