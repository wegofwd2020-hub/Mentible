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

export default function EntryDetailScreen() {
  const { sourceId, entryId } = useLocalSearchParams<{ sourceId: string; entryId: string }>();
  const cat = useSourceCatalog(sourceId);
  const entry = cat.entries.find((e) => e.id === entryId) ?? null;

  const [state, setState] = useState<DownloadState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Re-resolves the acquisition link against the feed URL and re-applies the
  // scheme allowlist at download time. Null for video and for anything unfetchable.
  const sourceUrl = cat.source?.url ?? "";
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
