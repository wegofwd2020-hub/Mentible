import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";
import { IS_DEMO } from "@/constants/demo";
import { FeedbackSheet } from "@/components/FeedbackSheet";

// A global "Send feedback" affordance: a floating button present on every screen
// once signed in (name/email come from the account). Hidden when signed out and
// in the demo build. Mounted once in app/_layout.tsx.
export function FeedbackFab(): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const { status } = useAuth();
  const [open, setOpen] = useState(false);

  if (IS_DEMO || status !== "signed_in") return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Send feedback"
        style={styles.fab}
      >
        <Text style={styles.fabText}>Feedback</Text>
      </Pressable>
      <FeedbackSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  // Fills the screen but lets touches through except on the button (box-none).
  wrap: {
    position: "absolute" as const,
    right: spacing.lg,
    bottom: spacing.xl,
    left: 0,
    top: 0,
    alignItems: "flex-end" as const,
    justifyContent: "flex-end" as const,
  },
  fab: {
    backgroundColor: c.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
});
