import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Shelf } from "@/storage/shelfStore";
import { colors, radius, spacing, typography } from "@/constants/theme";

export function MoveToShelfModal({
  visible,
  shelves,
  currentShelfId,
  onAssign,
  onCreateShelf,
  onClose,
}: {
  visible: boolean;
  shelves: Shelf[];
  currentShelfId: string | null;
  onAssign: (shelfId: string | null) => void;
  onCreateShelf: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Move to shelf</Text>
          <ScrollView style={styles.list}>
            {shelves.map((s) => {
              const active = s.id === currentShelfId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onAssign(s.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move to shelf: ${s.name}`}
                  style={styles.rowItem}
                >
                  <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.primary : colors.textMuted} />
                  <Text style={styles.rowText}>{s.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={onCreateShelf} accessibilityRole="button" accessibilityLabel="New shelf" style={styles.rowItem}>
            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            <Text style={[styles.rowText, { color: colors.primary }]}>New shelf…</Text>
          </Pressable>

          <Pressable onPress={() => onAssign(null)} accessibilityRole="button" accessibilityLabel="Remove from shelf" style={styles.rowItem}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.textMuted} />
            <Text style={styles.rowText}>Remove from shelf</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, maxHeight: "70%" },
  title: { fontSize: typography.sizeLg, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  rowText: { fontSize: typography.sizeMd, color: colors.text },
});
