import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

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
}): JSX.Element {
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
            placeholderTextColor={colors.textMuted}
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
    fontSize: typography.sizeMd,
  },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnText: { fontWeight: "700", color: colors.textSecondary, fontSize: typography.sizeMd },
  save: { backgroundColor: colors.primary },
  saveText: { color: colors.primaryText },
});
