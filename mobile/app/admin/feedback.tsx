import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAccount } from "@/hooks/useAccount";
import {
  feedbackExportUrl,
  getFeedback,
  listFeedback,
  type FeedbackDetail,
  type FeedbackFilters,
  type FeedbackRow,
} from "@/api/adminClient";
import { PageContainer } from "@/components/PageContainer";
import { Dropdown, type DropdownOption } from "@/components/Dropdown";
import { Alert } from "@/lib/alert";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

const TYPE_OPTIONS: DropdownOption[] = [
  { value: "", label: "All types" },
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "content_quality", label: "Content quality" },
  { value: "pricing", label: "Pricing" },
  { value: "other", label: "Other" },
];

const CONTACT_OPTIONS: DropdownOption[] = [
  { value: "", label: "All contact preferences" },
  { value: "email_follow_up", label: "Email follow-up" },
  { value: "feedback_only", label: "Feedback only" },
  { value: "schedule_call", label: "Schedule a call" },
];

const THIRTY_DAYS_MS = 30 * 864e5;

function defaultFilters(): FeedbackFilters {
  return { created_from: new Date(Date.now() - THIRTY_DAYS_MS).toISOString() };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Super-admin in-app feedback viewer (ADR-020 console). Read-only: lists +
// filters feedback submitted via FeedbackSheet (mobile/src/components/FeedbackSheet.tsx),
// opens a detail modal per row, and (web-only — native download is out of scope)
// exports the current filter as CSV/JSON via the audited /admin/feedback/export route.
export default function AdminFeedbackScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { status, accessToken } = useAuth();
  const { account } = useAccount();
  const isAdmin = account?.is_super_admin === true;

  const [filters, setFilters] = useState<FeedbackFilters>(defaultFilters);
  const [qInput, setQInput] = useState("");
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // The cursor lives in a ref, not state — `load` must NOT re-identify when a
  // "Load more" page lands, or the useFocusEffect below (which reloads whenever
  // `load`'s identity changes) would treat that page load as a filter change and
  // stomp the appended rows with a fresh reset fetch.
  const cursorRef = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Debounce the free-text search into `filters.q` (~300ms after typing stops).
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => {
        const q = qInput.trim() || undefined;
        if (f.q === q) return f;
        return { ...f, q };
      });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!accessToken) return;
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await listFeedback(accessToken, {
          ...filters,
          limit: 50,
          cursor: reset ? undefined : cursorRef.current,
        });
        setRows((prev) => (reset ? res.rows : [...prev, ...res.rows]));
        setNextCursor(res.next_cursor);
        cursorRef.current = res.next_cursor ?? undefined;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn’t load feedback.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accessToken, filters],
  );

  // Reload on filter change (load's identity changes with `filters`) and on
  // focus — mirrors app/admin.tsx.
  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load(true);
    }, [isAdmin, load]),
  );

  const openDetail = useCallback(
    (id: string) => {
      setModalVisible(true);
      setDetail(null);
      setDetailError(null);
      if (!accessToken) return;
      setDetailLoading(true);
      void (async () => {
        try {
          setDetail(await getFeedback(accessToken, id));
        } catch (e) {
          setDetailError(e instanceof Error ? e.message : "Couldn’t load this feedback item.");
        } finally {
          setDetailLoading(false);
        }
      })();
    },
    [accessToken],
  );

  const closeDetail = useCallback(() => {
    setModalVisible(false);
    setDetail(null);
    setDetailError(null);
  }, []);

  const clearFilters = useCallback(() => {
    setQInput("");
    setFilters({});
  }, []);

  const handleExport = useCallback(
    async (fmt: "csv" | "json") => {
      if (!accessToken) return;
      try {
        const url = feedbackExportUrl(filters, fmt);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        if (typeof document === "undefined") return;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `feedback.${fmt}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        Alert.alert("Export failed", e instanceof Error ? e.message : "Please try again.");
      }
    },
    [accessToken, filters],
  );

  if (status === "unavailable") return <Redirect href="/settings" />;
  if (status === "signed_out" || status === "loading") return <Redirect href="/sign-in" />;
  // Wait for the account (carries is_super_admin); then bounce non-operators.
  if (account && !isAdmin) return <Redirect href="/settings" />;

  return (
    <PageContainer>
      <Text style={styles.title}>Feedback</Text>
      <Text style={styles.sub}>In-app feedback submitted via the Send feedback sheet.</Text>

      <View style={styles.filterBar}>
        <Dropdown
          value={filters.type ?? ""}
          options={TYPE_OPTIONS}
          onChange={(v) => setFilters((f) => ({ ...f, type: v || undefined }))}
          accessibilityLabel="Filter by feedback type"
        />
        <Dropdown
          value={filters.contact_preference ?? ""}
          options={CONTACT_OPTIONS}
          onChange={(v) => setFilters((f) => ({ ...f, contact_preference: v || undefined }))}
          accessibilityLabel="Filter by contact preference"
        />
        <TextInput
          style={styles.search}
          value={qInput}
          onChangeText={setQInput}
          placeholder="Search name, email, text…"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Search feedback"
        />
        <Pressable
          style={styles.clearBtn}
          onPress={clearFilters}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>

      {Platform.OS === "web" ? (
        <View style={styles.exportRow}>
          <Pressable
            style={styles.exportBtn}
            onPress={() => void handleExport("csv")}
            accessibilityRole="button"
            accessibilityLabel="Export feedback as CSV"
          >
            <Text style={styles.exportText}>Export CSV</Text>
          </Pressable>
          <Pressable
            style={styles.exportBtn}
            onPress={() => void handleExport("json")}
            accessibilityRole="button"
            accessibilityLabel="Export feedback as JSON"
          >
            <Text style={styles.exportText}>Export JSON</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && rows.length === 0 ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          onRefresh={() => void load(true)}
          refreshing={loading}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => openDetail(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`View feedback from ${item.email}`}
            >
              <View style={styles.rowHead}>
                <Text style={styles.email} numberOfLines={1}>
                  {item.email}
                </Text>
                <Text style={styles.date}>{formatDateTime(item.created_at)}</Text>
              </View>
              <View style={styles.rowMeta}>
                {item.type ? <Text style={styles.chip}>{item.type}</Text> : null}
                <Text style={styles.page} numberOfLines={1}>
                  {item.page}
                </Text>
              </View>
              <Text style={styles.snippet} numberOfLines={2}>
                {item.snippet}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.meta}>No feedback in this range yet.</Text>}
          ListFooterComponent={
            nextCursor != null ? (
              <Pressable
                style={styles.loadMore}
                onPress={() => void load(false)}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel="Load more feedback"
              >
                <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more"}</Text>
              </Pressable>
            ) : null
          }
        />
      )}

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <ScrollView contentContainerStyle={styles.inner}>
              {detailLoading ? (
                <ActivityIndicator color={theme.primary} />
              ) : detailError ? (
                <Text style={styles.error}>{detailError}</Text>
              ) : detail ? (
                <>
                  <Text style={styles.detailTitle}>{detail.name}</Text>
                  <Text style={styles.detailLine}>{detail.email}</Text>
                  {detail.company ? <Text style={styles.detailLine}>{detail.company}</Text> : null}
                  {detail.role ? <Text style={styles.detailLine}>{detail.role}</Text> : null}
                  <Text style={styles.detailLine}>
                    {detail.type ?? "—"} · {detail.contact_preference ?? "—"}
                  </Text>
                  <Text style={styles.detailLine}>
                    {detail.app} · {detail.page}
                  </Text>
                  <Text style={styles.detailLine}>{formatDateTime(detail.created_at)}</Text>
                  <Text style={styles.detailText}>{detail.text}</Text>
                  <Text style={styles.payloadLabel}>Raw payload</Text>
                  <Text style={styles.payload}>{JSON.stringify(detail.payload, null, 2)}</Text>
                </>
              ) : null}
              <Pressable
                style={styles.closeBtn}
                onPress={closeDetail}
                accessibilityRole="button"
                accessibilityLabel="Close feedback detail"
              >
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </PageContainer>
  );
}

const makeStyles = (c: Palette) => ({
  title: { color: c.text, fontSize: typography.sizeXxl, fontWeight: "700" as const },
  sub: { color: c.textSecondary, fontSize: typography.sizeSm, marginBottom: spacing.md },
  filterBar: { gap: spacing.sm, marginBottom: spacing.sm },
  search: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  clearBtn: {
    alignSelf: "flex-start" as const,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  clearText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  exportRow: { flexDirection: "row" as const, gap: spacing.sm, marginBottom: spacing.md },
  exportBtn: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: c.surface,
  },
  exportText: { color: c.text, fontSize: typography.sizeSm, fontWeight: "600" as const },
  row: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowHead: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
  },
  email: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const, flex: 1 },
  date: { color: c.textMuted, fontSize: typography.sizeXs },
  rowMeta: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, marginTop: 4 },
  chip: {
    color: c.primaryText,
    backgroundColor: c.primary,
    fontSize: typography.sizeXs,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden" as const,
  },
  page: { color: c.textMuted, fontSize: typography.sizeXs, flex: 1 },
  snippet: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs },
  meta: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  error: { color: c.error, fontSize: typography.sizeSm, marginTop: spacing.md },
  loadMore: {
    alignSelf: "center" as const,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  loadMoreText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  backdrop: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" as const },
  card: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "90%" as const },
  inner: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing.xl },
  detailTitle: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  detailLine: { color: c.textSecondary, fontSize: typography.sizeSm },
  detailText: { color: c.text, fontSize: typography.sizeMd, marginTop: spacing.sm, marginBottom: spacing.sm },
  payloadLabel: { color: c.textMuted, fontSize: typography.sizeXs, fontWeight: "700" as const, textTransform: "uppercase" as const, marginTop: spacing.sm },
  payload: {
    color: c.textSecondary,
    fontSize: typography.sizeXs,
    fontFamily: "monospace",
    backgroundColor: c.background,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  closeBtn: {
    alignSelf: "flex-end" as const,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  closeText: { color: c.textSecondary, fontWeight: "700" as const, fontSize: typography.sizeMd },
});
