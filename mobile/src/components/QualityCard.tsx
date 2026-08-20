import React from "react";
import { Text, View } from "react-native";
import { spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { Card, Button } from "@/components/ui";
import type { QualityReport } from "@/api/trustClient";

interface Props {
  quality: QualityReport | null | undefined;
  isOwner: boolean;
  busy: boolean;
  onRunGrounding: () => void;
  origBusy?: boolean;
  onRunOriginality?: () => void;
}

// Surfaces the quality report (coverage + readability + an on-demand
// grounding/claim-support summary) on the trust version screens — see
// task-6-brief.md (P1-4 T6). Fail-open: renders nothing when `quality` is
// null/undefined, so an older backend that doesn't return `quality` yet
// changes nothing on screen. The "Run grounding check" button is owner-only
// (billable LLM pass) — shown when there's no result yet, AND when a result
// exists but is stale (a stale result on its own is a dead end without a way
// to re-run it; pressing the button re-runs and overwrites the stale report).
export function QualityCard({ quality, isOwner, busy, onRunGrounding, origBusy = false, onRunOriginality = () => {} }: Props): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  if (!quality) return null;

  const { coverage, readability, grounding, originality } = quality;
  const hasGaps = coverage.uncited_section_indexes.length > 0 || coverage.dangling.length > 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Quality</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Coverage</Text>
        <Text style={styles.value}>{`${coverage.sections_cited}/${coverage.sections_total} sections cite a source`}</Text>
        {hasGaps ? (
          <Text style={styles.subNote}>
            {`uncited: ${coverage.uncited_section_indexes.length} / dangling: ${coverage.dangling.length}`}
          </Text>
        ) : null}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Readability</Text>
        <Text style={styles.value}>{`Grade ${readability.grade_level} · Flesch ${readability.flesch_reading_ease}`}</Text>
        <Text style={styles.subNote}>Directional estimate — not a strict grade-level guarantee.</Text>
      </View>

      {/* Metric text on the left, the owner-only "Run …" action inline on the
          right (compact) — not a full-width row of its own. */}
      <View style={styles.metricRow}>
        <View style={styles.metricMain}>
          <Text style={styles.label}>Grounding</Text>
          {grounding ? (
            <>
              <Text style={styles.value}>{`${grounding.supported}/${grounding.claims_total} claims supported`}</Text>
              {grounding.partial || grounding.unsupported ? (
                <Text style={styles.subNote}>
                  {`${grounding.partial} partial, ${grounding.unsupported} unsupported`}
                </Text>
              ) : null}
              <Text style={styles.subNote}>{`checked ${new Date(grounding.checked_at).toLocaleString()}`}</Text>
              {grounding.stale ? <Text style={styles.staleNote}>inputs changed — re-run</Text> : null}
            </>
          ) : !isOwner ? (
            <Text style={styles.subNote}>Not yet checked.</Text>
          ) : null}
        </View>
        {isOwner && (!grounding || grounding.stale) ? (
          <Button
            variant="ghost"
            label="Run grounding check"
            accessibilityLabel="Run grounding check"
            busy={busy}
            onPress={onRunGrounding}
            style={styles.runBtn}
          />
        ) : null}
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metricMain}>
          <Text style={styles.label}>Originality</Text>
          {originality ? (
            <>
              <Text style={styles.value}>{`${originality.summary.clean}/${originality.summary.total} sections original`}</Text>
              {originality.summary.verbatim || originality.summary.paraphrase ? (
                <Text style={styles.subNote}>
                  {`${originality.summary.verbatim} verbatim, ${originality.summary.paraphrase} close paraphrase`}
                </Text>
              ) : null}
              <Text style={styles.subNote}>{`checked ${new Date(originality.checked_at).toLocaleString()}`}</Text>
              <Text style={styles.subNote}>Checks your draft against your cited sources only — not the web.</Text>
              {originality.stale ? <Text style={styles.staleNote}>inputs changed — re-run</Text> : null}
            </>
          ) : isOwner ? (
            <Text style={styles.subNote}>Checks your draft against your cited sources only — not the web.</Text>
          ) : (
            <Text style={styles.subNote}>Not yet checked.</Text>
          )}
        </View>
        {isOwner && (!originality || originality.stale) ? (
          <Button
            variant="ghost"
            label="Run originality check"
            accessibilityLabel="Run originality check"
            busy={origBusy}
            onPress={onRunOriginality}
            style={styles.runBtn}
          />
        ) : null}
      </View>
    </Card>
  );
}

const makeStyles = (c: Palette) => ({
  card: { gap: spacing.sm },
  title: { color: c.text, fontSize: typography.sizeLg, fontWeight: "700" as const },
  row: { gap: 2, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: c.border },
  // Grounding/Originality: text column + inline action button on the right.
  metricRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: c.border },
  metricMain: { flex: 1, gap: 2, minWidth: 0 },
  runBtn: { alignSelf: "center" as const, flexShrink: 0 },
  label: { color: c.textMuted, fontSize: typography.sizeXs, fontWeight: "700" as const, textTransform: "uppercase" as const },
  value: { color: c.text, fontSize: typography.sizeMd },
  subNote: { color: c.textMuted, fontSize: typography.sizeSm },
  staleNote: { color: c.error, fontSize: typography.sizeSm, fontWeight: "700" as const },
});
