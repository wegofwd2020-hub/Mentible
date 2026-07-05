import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftComment } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

function CommentRow({ comment, isOwner, onRespond }: { comment: DraftComment; isOwner: boolean; onRespond?: (id: number, r: string) => void }) {
  const [resp, setResp] = useState(comment.author_response ?? "");
  return (
    <View style={styles.row}>
      <Text style={styles.author}>{comment.author_email ?? "Reviewer"}</Text>
      <Text style={styles.body}>{comment.body}</Text>
      {comment.author_response ? (
        <Text style={styles.response}>Author: {comment.author_response}</Text>
      ) : null}
      {isOwner && onRespond ? (
        <View style={styles.respondRow}>
          <TextInput
            value={resp}
            onChangeText={setResp}
            placeholder="Respond…"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={`Response to comment ${comment.id}`}
            style={styles.respondInput}
          />
          <Pressable
            onPress={() => onRespond(comment.id, resp)}
            accessibilityRole="button"
            accessibilityLabel={`Save response to comment ${comment.id}`}
            style={styles.respondBtn}
          >
            <Text style={styles.respondBtnText}>Save</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function DraftCommentThread({
  comments, isOwner, onPost, onRespond,
}: {
  comments: DraftComment[];
  isOwner: boolean;
  onPost: (body: string) => void;
  onRespond?: (commentId: number, response: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const clean = draft.trim();
    if (!clean) return;
    onPost(clean);
    setDraft("");
  };
  return (
    <View style={styles.thread}>
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} isOwner={isOwner} onRespond={onRespond} />
      ))}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Add a comment"
          style={styles.input}
          multiline
        />
        <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Send comment" style={styles.sendBtn}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { gap: spacing.sm },
  row: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  author: { fontSize: typography.sizeXs, fontWeight: "700", color: colors.textSecondary },
  body: { fontSize: typography.sizeSm, color: colors.text },
  response: { fontSize: typography.sizeSm, color: colors.growth, fontStyle: "italic", marginTop: 2 },
  respondRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  respondInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, color: colors.text, fontSize: typography.sizeXs },
  respondBtn: { backgroundColor: colors.surfaceHigh, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: spacing.sm },
  respondBtnText: { color: colors.text, fontWeight: "700", fontSize: typography.sizeXs },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeSm, minHeight: 40 },
  sendBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  sendText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeSm },
});
