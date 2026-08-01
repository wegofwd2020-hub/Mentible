import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";

export function ShelfNameModal({
  visible,
  title,
  initialName,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialName?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState(initialName ?? "");

  // Reset the field each time the modal (re)opens.
  useEffect(() => {
    if (visible) setName(initialName ?? "");
  }, [visible, initialName]);

  const submit = () => {
    const clean = name.trim();
    if (!clean) return; // Save is a no-op on empty
    onSubmit(clean);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Shelf name"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Shelf name"
            style={styles.input}
            autoFocus
            onSubmitEditing={submit}
          />
          <View style={styles.row}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Save shelf name" style={[styles.btn, styles.save]}>
              <Text style={[styles.btnText, styles.saveText]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "center" as const, padding: spacing.xl },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  row: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: spacing.sm },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnText: { fontWeight: "700" as const, color: c.textSecondary, fontSize: typography.sizeMd },
  save: { backgroundColor: c.primary },
  saveText: { color: c.primaryText },
});
