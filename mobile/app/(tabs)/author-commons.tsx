import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { BookCover } from "@/components/BookCover";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useAuth } from "@/auth/AuthProvider";
import { listAuthorCommons, type CommonsSummary } from "@/api/client";
import { spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";
import { Card } from "@/components/ui";

const SEARCH_DEBOUNCE_MS = 300;

// Fixed short list: the commons is small at launch, so a static picker is
// enough. "" means all languages.
const LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "All" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "ta", label: "Tamil" },
];

function AuthorCommonsInner() {
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [items, setItems] = useState<CommonsSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Debounce the search box into `query`.
  useEffect(() => {
    if (text === query) return;
    const t = setTimeout(() => setQuery(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, query]);

  useEffect(() => {
    if (!accessToken) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    listAuthorCommons(accessToken, { query: query || undefined, language: language || undefined })
      .then((page) => {
        if (mine !== seq.current) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setError("Couldn't load Author Commons. Try again in a moment.");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [accessToken, query, language]);

  const header = (
    <View style={styles.controls}>
      <TextInput
        style={styles.search}
        value={text}
        onChangeText={setText}
        placeholder="Search books"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Search Author Commons"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.langRow}>
        {LANGUAGES.map((l) => (
          <Pressable
            key={l.code || "all"}
            accessibilityRole="button"
            accessibilityLabel={`Language: ${l.label}`}
            accessibilityState={{ selected: language === l.code }}
            onPress={() => setLanguage(l.code)}
            style={[styles.langChip, language === l.code && styles.langChipOn]}
          >
            <Text style={[styles.langText, language === l.code && styles.langTextOn]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  let body;
  if (error) {
    body = <Text style={styles.error}>{error}</Text>;
  } else if (loading && items.length === 0) {
    body = <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />;
  } else if (total === 0) {
    body = (
      <View style={styles.centerBox}>
        <Text style={styles.empty}>No books in Author Commons yet.</Text>
        <Text style={styles.emptySub}>Try a different search or language, or publish one of your own.</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(b) => b.book_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open book: ${item.title}`}
            onPress={() => router.push(`/author-commons/${item.book_id}`)}
          >
            <Card style={styles.row}>
              <View style={styles.coverBox}>
                <BookCover title={item.title} coverSvg={item.cover_svg ?? undefined} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowMeta}>{item.author_name}</Text>
                <Text style={styles.rowMeta}>{item.formats.map((f) => f.toUpperCase()).join(" · ")}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      {body}
    </View>
  );
}

export default function AuthorCommonsScreen() {
  return (
    <RequireSignIn action="browse Author Commons">
      <PageContainer style={{ flex: 1 }}>
        <AuthorCommonsInner />
      </PageContainer>
    </RequireSignIn>
  );
}

const makeStyles = (c: Palette) => ({
  controls: { padding: spacing.md, gap: spacing.sm },
  search: {
    color: c.text,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizeMd,
  },
  langRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  langChip: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  langChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  langText: { color: c.textSecondary, fontSize: typography.sizeSm },
  langTextOn: { color: "#ffffff" },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  coverBox: { width: 56 },
  rowTitle: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  rowMeta: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeXl },
  centerBox: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  empty: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  emptySub: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" as const },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const, padding: spacing.xl },
});
