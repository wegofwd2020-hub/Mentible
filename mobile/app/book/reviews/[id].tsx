import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "@/lib/alert";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import {
  addReview,
  deleteReview,
  editReview,
  listReviews,
  type Review,
} from "@/storage/reviewStore";
import { maybeSeedReviews } from "@/storage/seedReviews";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Per-book reviews: a list of feedback received on the book; tap one to read its
// full text. Reviews are added by pasting (local-first — see reviewStore). The
// book id comes from the route; the title is passed for the header + context.
export default function BookReviewsScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const navigation = useNavigation();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<Review | null>(null);
  // Editor: null = closed, "new" = add, a Review = edit that review.
  const [editor, setEditor] = useState<"new" | Review | null>(null);

  // Editor form fields (only relevant while the editor modal is open).
  const [fTitle, setFTitle] = useState("");
  const [fReviewer, setFReviewer] = useState("");
  const [fBody, setFBody] = useState("");

  useEffect(() => {
    navigation.setOptions({ title: title ? `Reviews · ${title}` : "Reviews" });
  }, [navigation, title]);

  const reload = useCallback(() => {
    if (!id) return;
    setLoading(true);
    maybeSeedReviews(id)
      .catch(() => false)
      .then(() => listReviews(id))
      .then(setReviews)
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => reload(), [reload]);

  const openAdd = useCallback(() => {
    setFTitle("");
    setFReviewer("");
    setFBody("");
    setEditor("new");
  }, []);

  const openEdit = useCallback((r: Review) => {
    setFTitle(r.title);
    setFReviewer(r.reviewer ?? "");
    setFBody(r.body);
    setReading(null);
    setEditor(r);
  }, []);

  const saveEditor = useCallback(async () => {
    if (!id || !editor) return;
    const body = fBody.trim();
    if (!body) {
      Alert.alert("Nothing to save", "Paste the review text first.");
      return;
    }
    const title2 = fTitle.trim() || body.slice(0, 40).replace(/\s+\S*$/, "") || "Untitled review";
    if (editor === "new") {
      await addReview(id, { title: title2, reviewer: fReviewer, body });
    } else {
      await editReview(id, editor.id, { title: title2, reviewer: fReviewer, body });
    }
    setEditor(null);
    reload();
  }, [id, editor, fTitle, fReviewer, fBody, reload]);

  const confirmDelete = useCallback(
    (review: Review) => {
      const doDelete = async () => {
        if (!id) return;
        await deleteReview(id, review.id);
        setReviews((prev) => prev.filter((r) => r.id !== review.id));
      };
      if (Platform.OS === "web") {
        // RN Alert on web has no buttons — delete directly.
        void doDelete();
        return;
      }
      Alert.alert("Delete review?", `"${review.title}" will be removed from this device.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ]);
    },
    [id],
  );

  const addButton = (
    <Pressable
      style={styles.addBtn}
      onPress={openAdd}
      accessibilityRole="button"
      accessibilityLabel="Add a review"
    >
      <Ionicons name="add" size={16} color={theme.primary} />
      <Text style={styles.addBtnText}>Add review</Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <View style={styles.header}>
          <Text style={styles.heading}>
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </Text>
          {addButton}
        </View>

        {reviews.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyTitle}>No reviews yet</Text>
            <Text style={styles.emptyBody}>
              Received feedback on this book? Tap “Add review” to paste it in and keep
              it here to re-read.
            </Text>
          </View>
        ) : (
          reviews.map((r) => (
            <View key={r.id} style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => setReading(r)}
                accessibilityRole="button"
                accessibilityLabel={`Read review: ${r.title}`}
              >
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {r.title}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {r.reviewer ? `${r.reviewer} · ` : ""}
                  {formatDate(r.createdAt)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => confirmDelete(r)}
                accessibilityRole="button"
                accessibilityLabel={`Delete review: ${r.title}`}
                hitSlop={8}
                style={styles.rowDelete}
              >
                <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
              </Pressable>
            </View>
          ))
        )}
      </PageContainer>

      {/* Reader — the full review text in a scrollable box. */}
      <Modal
        visible={reading !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setReading(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {reading?.title}
              </Text>
              <Pressable
                onPress={() => reading && openEdit(reading)}
                accessibilityRole="button"
                accessibilityLabel="Edit review"
                hitSlop={8}
              >
                <Ionicons name="create-outline" size={20} color={theme.primary} />
              </Pressable>
              <Pressable
                onPress={() => setReading(null)}
                accessibilityRole="button"
                accessibilityLabel="Close review"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            {reading?.reviewer || reading?.createdAt ? (
              <Text style={styles.modalMeta}>
                {reading?.reviewer ? `${reading.reviewer} · ` : ""}
                {reading ? formatDate(reading.createdAt) : ""}
              </Text>
            ) : null}
            <ScrollView style={styles.readerBox} contentContainerStyle={styles.readerContent}>
              <Text selectable style={styles.readerText}>
                {reading?.body}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Editor — paste a new review, or edit an existing one. */}
      <Modal
        visible={editor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditor(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {editor === "new" ? "Add review" : "Edit review"}
              </Text>
              <Pressable
                onPress={() => setEditor(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.form}>
              <Text style={styles.label}>Title (optional)</Text>
              <TextInput
                style={styles.input}
                value={fTitle}
                onChangeText={setFTitle}
                placeholder="e.g. Sridhar — targeting & flow"
                placeholderTextColor={theme.textMuted}
              />
              <Text style={styles.label}>Reviewer (optional)</Text>
              <TextInput
                style={styles.input}
                value={fReviewer}
                onChangeText={setFReviewer}
                placeholder="e.g. Sridhar Parthasarathy"
                placeholderTextColor={theme.textMuted}
              />
              <Text style={styles.label}>Review text</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={fBody}
                onChangeText={setFBody}
                placeholder="Paste the review here…"
                placeholderTextColor={theme.textMuted}
                multiline
                textAlignVertical="top"
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setEditor(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.saveBtn}
                onPress={saveEditor}
                accessibilityRole="button"
                accessibilityLabel="Save review"
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: c.background },
  scrollContent: { flexGrow: 1 },
  centered: {
    flex: 1,
    backgroundColor: c.background,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: spacing.md,
  },
  heading: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },

  addBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: c.primary + "1A",
  },
  addBtnText: { color: c.primary, fontWeight: "700" as const, fontSize: typography.sizeSm },

  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: typography.sizeMd, fontWeight: "600" as const, color: c.text },
  rowMeta: { fontSize: typography.sizeXs, color: c.textMuted },
  rowDelete: { padding: spacing.xs },

  empty: { alignItems: "center" as const, paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  emptyBody: {
    fontSize: typography.sizeSm,
    color: c.textMuted,
    textAlign: "center" as const,
    lineHeight: 22,
    maxWidth: 320,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end" as const,
  },
  modalCard: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "85%" as const,
  },
  modalHead: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  modalTitle: { flex: 1, fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  modalMeta: { fontSize: typography.sizeXs, color: c.textMuted, marginBottom: spacing.sm },

  readerBox: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.background,
    marginTop: spacing.sm,
  },
  readerContent: { padding: spacing.md },
  readerText: {
    fontSize: typography.sizeMd,
    color: c.text,
    lineHeight: 24,
  },

  form: { gap: spacing.xs, paddingBottom: spacing.md },
  label: { fontSize: typography.sizeXs, color: c.textSecondary, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.background,
    color: c.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizeMd,
  },
  inputMultiline: { minHeight: 160 },

  modalActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  cancelBtnText: { color: c.textSecondary, fontWeight: "700" as const, fontSize: typography.sizeMd },
  saveBtn: {
    backgroundColor: c.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  saveBtnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeMd },
});
