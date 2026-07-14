// Entry detail route: loads the entry from the source catalog, opens its source
// link via Linking (canonicalUrl is scheme-allowlisted in plan 1, so this is safe),
// and owns the download (the engine call + the platform branch — EntryDetail stays
// presentational).
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { EntryDetail, type DownloadState } from "@/openshelves/EntryDetail";
import { pickDownloadLink } from "@/openshelves/downloadTarget";
import { downloadEntry } from "@/openshelves/downloadEngine";
import { browserDownload, makeIO, supportsOfflineDownloads } from "@/openshelves/downloadIO";
import { toMessage } from "@/openshelves/errorMessage";
import { getBrowseFrame } from "@/openshelves/browseContext";

export default function EntryDetailScreen() {
  const { sourceId, entryId } = useLocalSearchParams<{ sourceId: string; entryId: string }>();
  const cat = useSourceCatalog(sourceId);

  // A leaf entry reached inside a drilled-in sub-feed was never written to
  // the stored catalog (cat.entries) — only the browseContext registry knows
  // about it. Resolve from there FIRST, falling back to the stored root
  // catalog when there's no browse context (app restart, deep link) — see
  // FIX 1 / browseContext.ts. The base URL always comes from the SAME frame
  // the entry was resolved from: mixing a browse-context entry with the
  // root's URL (or vice versa) resolves relative acquisition hrefs wrong.
  const browseFrame = getBrowseFrame(sourceId);
  const fromBrowseFrame = browseFrame?.entries.find((e) => e.id === entryId) ?? null;
  const entry = fromBrowseFrame ?? cat.entries.find((e) => e.id === entryId) ?? null;
  const sourceUrl = fromBrowseFrame ? browseFrame!.url : (cat.source?.url ?? "");

  const [state, setState] = useState<DownloadState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Re-resolves the acquisition link against the feed URL and re-applies the
  // scheme allowlist at download time. Null for video and for anything unfetchable.
  const target = entry ? pickDownloadLink(entry, sourceUrl) : null;

  const onDownload = async () => {
    if (!entry || !target) return;

    // On web the browser performs the transfer, so we never learn the byte count
    // the engine verifies against — routing this through downloadEntry would
    // quarantine every successful download as "empty". Fire-and-forget instead.
    if (!supportsOfflineDownloads) {
      browserDownload(target.url);
      setState("browser");
      return;
    }

    setState("downloading");
    setError(null);
    try {
      await downloadEntry(entry, sourceId, sourceUrl, makeIO());
      setState("done");
    } catch (err) {
      setError(toMessage(err));
      setState("error");
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        {entry ? (
          <EntryDetail
            entry={entry}
            sourceTitle={cat.source?.title ?? cat.source?.url ?? "Unknown source"}
            onViewAtSource={(url) => { void Linking.openURL(url); }}
            canDownload={target !== null}
            onDownload={() => { void onDownload(); }}
            downloadState={state}
            downloadError={error}
          />
        ) : (
          <Text style={styles.missing}>{cat.loading ? "Loading…" : "Entry not found."}</Text>
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  missing: { color: colors.textMuted, marginTop: spacing.lg },
});
