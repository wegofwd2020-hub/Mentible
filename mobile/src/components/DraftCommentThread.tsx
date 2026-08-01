import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftComment } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

function CommentRow({ comment, isOwner, onRespond, styles, theme }: { comment: DraftComment; isOwner: boolean; onRespond?: (id: number, r: string) => void; styles: ReturnType<typeof makeStyles>; theme: Palette }) {
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
            placeholderTextColor={theme.textMuted}
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
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <CommentRow key={c.id} comment={c} isOwner={isOwner} onRespond={onRespond} styles={styles} theme={theme} />
      ))}
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) => ({
  thread: { gap: spacing.sm },
  row: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  author: { fontSize: typography.sizeXs, fontWeight: "700" as const, color: c.textSecondary },
  body: { fontSize: typography.sizeSm, color: c.text },
  response: { fontSize: typography.sizeSm, color: c.growth, fontStyle: "italic" as const, marginTop: 2 },
  respondRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, marginTop: spacing.xs },
  respondInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, padding: spacing.xs, color: c.text, fontSize: typography.sizeXs },
  respondBtn: { backgroundColor: c.surfaceHigh, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: spacing.sm },
  respondBtnText: { color: c.text, fontWeight: "700" as const, fontSize: typography.sizeXs },
  composer: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeSm, minHeight: 40 },
  sendBtn: { backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  sendText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
});
