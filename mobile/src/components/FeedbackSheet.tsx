import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { usePathname } from "expo-router";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/lib/alert";
import { ApiError } from "@/api/client";
import { Dropdown } from "@/components/Dropdown";
import { sendFeedback, type ContactPreference, type FeedbackType } from "@/api/feedbackClient";

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug or unexpected behavior" },
  { value: "feature", label: "Feature suggestion" },
  { value: "content_quality", label: "Content quality" },
  { value: "pricing", label: "Pricing or pilot terms" },
  { value: "other", label: "Something else" },
];

const CONTACT: { value: ContactPreference; label: string }[] = [
  { value: "email_follow_up", label: "Yes, email me to follow up" },
  { value: "feedback_only", label: "No, feedback only" },
  { value: "schedule_call", label: "Yes, schedule a 15-minute call" },
];

const MAX_TEXT = 2048;

export function FeedbackSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { session, accessToken } = useAuth();
  const page = usePathname();

  const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const prefillName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    "";
  const email = session?.user?.email ?? "";

  const [name, setName] = useState(prefillName);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [type, setType] = useState<FeedbackType>("bug");
  const [text, setText] = useState("");
  const [contact, setContact] = useState<ContactPreference>("email_follow_up");
  const [busy, setBusy] = useState(false);

  // Re-seed the editable name each time the sheet opens (company/role/text reset).
  useEffect(() => {
    if (visible) {
      setName(prefillName);
      setCompany("");
      setRole("");
      setType("bug");
      setText("");
      setContact("email_follow_up");
    }
    // prefillName derives from session; intentionally not a dep (only re-seed on open)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = () => {
    if (busy) return;
    if (!accessToken) {
      Alert.alert("Sign in first", "Please sign in to send feedback.");
      return;
    }
    if (!text.trim()) {
      Alert.alert("Add your feedback", "Please write a few words before sending.");
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        await sendFeedback(
          {
            name: name.trim() || "Anonymous",
            company: company.trim() || undefined,
            role: role.trim() || undefined,
            type,
            text: text.trim(),
            contact_preference: contact,
            page,
          },
          accessToken,
        );
        // Repeatable: clear the message + selections, keep name/company/role, stay open.
        setText("");
        setType("bug");
        setContact("email_follow_up");
        Alert.alert("Thank you", "Your feedback was sent. You can send another anytime.");
      } catch (e) {
        Alert.alert("Couldn't send", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Send feedback</Text>
            <Text style={styles.subtitle}>
              Tell us what&apos;s working, what&apos;s confusing, or what to build next.
            </Text>

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} accessibilityLabel="Name" editable={!busy} />

            <Text style={styles.label}>Email</Text>
            <View style={[styles.input, styles.readonly]}>
              <Text style={styles.readonlyText}>{email || "—"}</Text>
            </View>

            <Text style={styles.label}>Company / project (optional)</Text>
            <TextInput style={styles.input} value={company} onChangeText={setCompany} maxLength={255} accessibilityLabel="Company or project" editable={!busy} />

            <Text style={styles.label}>Role (optional)</Text>
            <TextInput style={styles.input} value={role} onChangeText={setRole} maxLength={255} placeholder="e.g. Founder, Subject-matter expert" placeholderTextColor={theme.textMuted} accessibilityLabel="Role" editable={!busy} />

            <Text style={styles.label}>What kind of feedback is this?</Text>
            <Dropdown value={type} options={TYPES} onChange={(v) => setType(v as FeedbackType)} accessibilityLabel="Feedback type" />

            <Text style={styles.label}>Your feedback</Text>
            <TextInput
              style={styles.textarea}
              value={text}
              onChangeText={setText}
              maxLength={MAX_TEXT}
              multiline
              placeholder="Max 2,000 characters. Please don't share passwords or private customer data."
              placeholderTextColor={theme.textMuted}
              accessibilityLabel="Feedback text"
              editable={!busy}
            />
            <Text style={styles.counter}>{text.length}/{MAX_TEXT}</Text>

            <Text style={styles.label}>Can we reach you?</Text>
            <Dropdown value={contact} options={CONTACT} onChange={(v) => setContact(v as ContactPreference)} accessibilityLabel="Contact preference" />

            <View style={styles.row}>
              <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Close feedback" style={styles.btn}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
              <Pressable onPress={submit} disabled={busy} accessibilityRole="button" accessibilityLabel="Send feedback" style={[styles.btn, styles.send, busy && styles.disabled]}>
                <Text style={[styles.btnText, styles.sendText]}>{busy ? "Sending…" : "Send feedback"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  backdrop: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" as const },
  card: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "90%" as const },
  inner: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  title: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  subtitle: { fontSize: typography.sizeSm, color: c.textMuted, marginBottom: spacing.sm },
  label: { fontSize: typography.sizeSm, color: c.textSecondary, fontWeight: "600" as const, marginTop: spacing.xs },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd },
  readonly: { backgroundColor: c.background, justifyContent: "center" as const },
  readonlyText: { color: c.textMuted, fontSize: typography.sizeMd },
  textarea: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, color: c.text, fontSize: typography.sizeMd, minHeight: 110, textAlignVertical: "top" as const },
  counter: { alignSelf: "flex-end" as const, color: c.textMuted, fontSize: typography.sizeSm },
  row: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: spacing.sm, marginTop: spacing.md },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnText: { fontWeight: "700" as const, color: c.textSecondary, fontSize: typography.sizeMd },
  send: { backgroundColor: c.primary },
  sendText: { color: c.primaryText },
  disabled: { opacity: 0.5 },
});
