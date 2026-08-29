import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// A themed single-select dropdown that works on web AND native (no
// @react-native-picker dep): a trigger button shows the current selection; tapping
// it opens a Modal list of options. Replaces radio-chip rows where one choice out
// of several reads better as a compact control with the current value always
// visible (e.g. the generation engine/provider).

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

export function Dropdown({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? "Open selection"}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.triggerText}>
          <Text style={styles.triggerLabel}>{selected?.label ?? "Select…"}</Text>
          {selected?.description ? (
            <Text style={styles.triggerDesc}>{selected.description}</Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Backdrop closes on tap; the sheet swallows taps so a row press selects. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ScrollView>
              {options.map((o) => {
                const isSel = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    style={[styles.option, isSel && styles.optionSelected]}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSel }}
                    accessibilityLabel={o.label}
                  >
                    <View style={styles.optionText}>
                      <Text style={[styles.optionLabel, isSel && styles.optionLabelSelected]}>
                        {o.label}
                      </Text>
                      {o.description ? (
                        <Text style={styles.optionDesc}>{o.description}</Text>
                      ) : null}
                    </View>
                    {isSel ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (c: Palette) => ({
  trigger: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  triggerText: { flex: 1 },
  triggerLabel: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  triggerDesc: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  chevron: { color: c.textMuted, fontSize: typography.sizeMd },
  backdrop: {
    flex: 1,
    backgroundColor: "#0008",
    justifyContent: "center" as const,
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    maxHeight: "70%" as const,
    overflow: "hidden" as const,
  },
  option: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  optionSelected: { backgroundColor: c.brand + "18" },
  optionText: { flex: 1 },
  optionLabel: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  optionLabelSelected: { color: c.brand },
  optionDesc: { color: c.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
  check: { color: c.brand, fontSize: typography.sizeMd, fontWeight: "700" as const },
});
