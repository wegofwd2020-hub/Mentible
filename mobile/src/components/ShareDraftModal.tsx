import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Alert } from "@/lib/alert";
import {
  addInvitation, listComments, listInvitations, postComment, revokeInvitation, setCommentResponse, shareDraft,
  type DraftComment, type DraftInvitation,
} from "@/api/client";
import { DraftCommentThread } from "@/components/DraftCommentThread";
import type { Book } from "@/types/book";
import { colors, radius, spacing, typography } from "@/constants/theme";

// Author-facing sharing sheet for a draft book (ADR-027 D2-D4): shares the
// current draft to the backend on open, then lets the author invite reviewers
// by email, revoke access, and read/respond to reviewer comments.
export function ShareDraftModal({
  visible, book, token, onClose,
}: { visible: boolean; book: Book; token: string; onClose: () => void }): React.JSX.Element {
  const version = book.metadata?.version ?? "1.0";
  const [invites, setInvites] = useState<DraftInvitation[]>([]);
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInvites(await listInvitations(book.id, token));
      setComments(await listComments(book.id, version, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load sharing.");
    }
  }, [book.id, token, version]);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      try {
        await shareDraft(book, token); // upsert the current draft server-side
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't share the draft.");
      }
    })();
  }, [visible, book, token, refresh]);

  const active = invites.filter((i) => !i.revoked_at);

  const invite = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    setError(null);
    try {
      await addInvitation(book.id, clean, token);
      setEmail("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that email.");
    }
  };
  const revoke = (e: string) => {
    Alert.alert("Remove access?", `${e} will no longer see this draft.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void revokeInvitation(book.id, e, token).then(refresh).catch(() => {}) },
    ]);
  };
  const onPost = (body: string) =>
    void postComment(book.id, version, body, token)
      .then(refresh)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't post your comment."));
  const onRespond = (id: number, r: string) =>
    void setCommentResponse(book.id, id, r, token)
      .then(refresh)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't save your response."));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Share “{book.title}”</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.section}>Reviewers</Text>
            <View style={styles.inviteRow}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="name@email.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                accessibilityLabel="Invite by email"
                style={styles.input}
              />
              <Pressable onPress={invite} accessibilityRole="button" accessibilityLabel="Send invite" style={styles.inviteBtn}>
                <Text style={styles.inviteBtnText}>Invite</Text>
              </Pressable>
            </View>
            {active.map((i) => (
              <View key={i.invited_email} style={styles.inviteItem}>
                <Text style={styles.inviteEmail}>{i.invited_email}</Text>
                <Pressable onPress={() => revoke(i.invited_email)} accessibilityRole="button" accessibilityLabel={`Remove ${i.invited_email}`} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <Text style={[styles.section, { marginTop: spacing.md }]}>Comments (v{version})</Text>
            <DraftCommentThread comments={comments} isOwner onPost={onPost} onRespond={onRespond} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, flexShrink: 1 },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  content: { gap: spacing.xs, paddingBottom: spacing.lg },
  section: { fontSize: typography.sizeSm, fontWeight: "700", color: colors.textSecondary },
  inviteRow: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeSm },
  inviteBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, justifyContent: "center" },
  inviteBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
  inviteItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.xs },
  inviteEmail: { fontSize: typography.sizeSm, color: colors.text },
});
