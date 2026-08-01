// Catalog for one source (spec P0-1 "view details"). Plaintext entries; tapping
// a leaf entry opens its detail. A navigation entry drills into its sub-feed
// in place (OPDS catalogs are a tree — Task 3's useFeedBrowser fetches the
// sub-feed on demand; those entries are transient and never written to the
// store). No downloads here (later plan).
import { ScrollView, Text, View, Pressable } from "react-native";
import { useEffect, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { useFeedBrowser } from "@/openshelves/useFeedBrowser";
import { EntryRow } from "@/openshelves/EntryRow";
import { ShelfFilterBar } from "@/openshelves/ShelfFilterBar";
import { useShelfPrefs } from "@/openshelves/useShelfPrefs";
import { filterEntries } from "@/openshelves/filterEntries";
import { publishBrowseFrame } from "@/openshelves/browseContext";

export default function CatalogScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const cat = useSourceCatalog(sourceId);

  const root = useMemo(
    () => ({ title: cat.source?.title ?? "Catalog", url: cat.source?.url ?? "", entries: cat.entries }),
    [cat.source?.title, cat.source?.url, cat.entries],
  );
  const browser = useFeedBrowser(root);
  const { prefs, setPrefs, loading: prefsLoading } = useShelfPrefs();
  const shown = filterEntries(browser.frame.entries, prefs);

  // Publish the current frame (root OR a drilled-in sub-feed) to the
  // transient in-memory browseContext registry — NOT AsyncStorage, NOT any
  // store — so the [entryId] route (a separate expo-router push, mounted
  // after this screen and useFeedBrowser's `pushed` stack are gone) can
  // still resolve a leaf entry reached only inside a sub-feed, against the
  // URL of the frame it actually came from (see FIX 1 / browseContext.ts).
  // Keying on `browser.frame` (an object that changes identity on every
  // enter() AND every back()) is load-bearing: it's what keeps the registry
  // from ever going stale, since back() replaces `pushed` with a new array
  // (see useFeedBrowser.back()) and this effect re-fires and overwrites the
  // registry with the true root frame. See browseContext.ts for what breaks
  // if a future change makes this effect skip a back() transition.
  useEffect(() => {
    if (sourceId) publishBrowseFrame(sourceId, browser.frame.url, browser.frame.entries);
  }, [sourceId, browser.frame]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>{browser.frame.title}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{shown.length} of {browser.frame.entries.length} shown</Text>
          <View style={styles.headerActions}>
            {browser.canGoBack ? (
              <Pressable testID="browse-back" onPress={browser.back}><Text style={styles.back}>‹ Back</Text></Pressable>
            ) : null}
            <Pressable testID="catalog-refresh" onPress={() => void cat.refresh()} disabled={cat.busy}>
              <Text style={styles.refresh}>Refresh</Text>
            </Pressable>
          </View>
        </View>
        {/* Mount-race guard: useShelfPrefs starts with defaultPrefs()+loading:true
            before the persisted value resolves. Rendering the bar during that
            window would let a press build `{ ...prefs, ... }` on the still-default
            prefs and clobber a real stored value on write — so withhold the bar
            (not the filtered list; filtering with the in-flight default is safe)
            until the persisted prefs have actually loaded. */}
        {!prefsLoading ? (
          <ShelfFilterBar entries={browser.frame.entries} prefs={prefs} onChange={(p) => void setPrefs(p)} />
        ) : null}
        {cat.error ? <Text testID="catalog-error" style={styles.error}>{cat.error}</Text> : null}
        {browser.error ? <Text testID="browse-error" style={styles.error}>{browser.error}</Text> : null}
        {cat.loading && shown.length === 0 ? null : shown.length === 0 ? (
          <Text style={styles.empty}>No items in this catalog.</Text>
        ) : (
          shown.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onPress={() => {
                if (e.navigationUrl && e.links.length === 0) void browser.enter(e);
                else router.push(`/shelves/${sourceId}/${e.id}`);
              }}
            />
          ))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const, backgroundColor: c.background },
  content: { paddingVertical: spacing.lg },
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  headerRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginVertical: spacing.md },
  headerActions: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  sub: { color: c.textMuted, fontSize: typography.sizeMd },
  back: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "600" as const },
  refresh: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "600" as const },
  error: { color: c.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  empty: { color: c.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
