import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
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

// Width at/above which the sheet becomes a draggable floating panel (room for a
// ~400px panel + margins); below it stays a full-width bottom sheet (phones).
const FLOAT_MIN_WIDTH = 700;
const PANEL_W = 400;
const MARGIN = 16;

// Read an Animated.Value's current number without the public API exposing it.
const valueOf = (v: Animated.Value): number => (v as unknown as { _value: number })._value;

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
  const { width, height } = useWindowDimensions();
  const floating = width >= FLOAT_MIN_WIDTH;

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

  // Draggable position of the floating panel (translate from top-left).
  const startPos = () => ({ x: Math.max(MARGIN, width - PANEL_W - MARGIN), y: 72 });
  const pan = useRef(new Animated.ValueXY(startPos())).current;

  // Re-seed the editable name each time the sheet opens (company/role/text reset),
  // and reset the panel to its top-right start position.
  useEffect(() => {
    if (visible) {
      setName(prefillName);
      setCompany("");
      setRole("");
      setType("bug");
      setText("");
      setContact("email_follow_up");
      pan.setValue(startPos());
    }
    // Only re-seed on open — prefillName/width derive from session/window and
    // must not retrigger the reset mid-session.
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      // Only start dragging on a real move (so a tap on the close button still works).
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        pan.setOffset({ x: valueOf(pan.x), y: valueOf(pan.y) });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // Clamp so the panel can't be dragged off-screen (keep the header reachable).
        const maxX = Math.max(MARGIN, width - PANEL_W - MARGIN);
        const maxY = Math.max(MARGIN, height - 120);
        const cx = Math.min(Math.max(MARGIN, valueOf(pan.x)), maxX);
        const cy = Math.min(Math.max(MARGIN, valueOf(pan.y)), maxY);
        Animated.spring(pan, { toValue: { x: cx, y: cy }, useNativeDriver: false, bounciness: 0 }).start();
      },
    }),
  ).current;

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

  // The form fields — shared by both the floating panel and the bottom sheet.
  const fields = (
    <>
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
    </>
  );

  if (floating) {
    const panelMaxH = Math.min(height - MARGIN * 2, 680);
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        {/* No dark backdrop: box-none lets the app stay visible + interactive
            behind the panel, so the user can see what they're reporting on. */}
        <View style={styles.floatRoot} pointerEvents="box-none">
          <Animated.View
            style={[styles.panel, { maxHeight: panelMaxH, transform: pan.getTranslateTransform() }]}
          >
            <View style={styles.dragHeader} {...panResponder.panHandlers}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Send feedback</Text>
                <Text style={styles.dragHint}>Drag to move · see the screen behind</Text>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close feedback" hitSlop={12} style={styles.closeBtn}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.panelInner} keyboardShouldPersistTaps="handled">
              {fields}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // Phone: full-width bottom sheet (dragging isn't useful on a small screen).
  // Backdrop lightened so a little of the screen shows through above the sheet.
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Send feedback</Text>
            <Text style={styles.subtitle}>
              Tell us what&apos;s working, what&apos;s confusing, or what to build next.
            </Text>
            {fields}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  // ── Phone bottom sheet ──────────────────────────────────────────────────
  backdrop: { flex: 1, backgroundColor: "#0006", justifyContent: "flex-end" as const },
  card: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "90%" as const },
  inner: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  subtitle: { fontSize: typography.sizeSm, color: c.textMuted, marginBottom: spacing.sm },

  // ── Floating draggable panel (web/wide) ─────────────────────────────────
  floatRoot: { flex: 1 },
  panel: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: PANEL_W,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    overflow: "hidden" as const,
  },
  dragHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.surfaceHigh,
    // Web-only affordance that this bar is draggable.
    ...(Platform.OS === "web" ? ({ cursor: "move" } as object) : {}),
  },
  dragHint: { fontSize: typography.sizeXs, color: c.textMuted, marginTop: 1 },
  closeBtn: { width: 28, height: 28, alignItems: "center" as const, justifyContent: "center" as const },
  close: { fontSize: typography.sizeXl, color: c.textSecondary, lineHeight: typography.sizeXl },
  panelInner: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },

  // ── Shared field styles ─────────────────────────────────────────────────
  title: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
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
