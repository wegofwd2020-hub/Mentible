import React, { useState } from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { useAuth } from "@/auth/AuthProvider";
import { IS_DEMO } from "@/constants/demo";
import { FeedbackSheet } from "@/components/FeedbackSheet";

const SIZE = 44;

// Top-right "Send feedback" affordance, sized to sit inline with the account
// avatar (UserChip) in the nav chrome (TopNavBar / SideNav) and the stack header
// (StudioHeader). Opens the shared FeedbackSheet. Hidden when signed out and in
// the demo build. Replaces the old floating bottom-right FAB.
export function FeedbackHeaderButton(): React.JSX.Element | null {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const { status } = useAuth();
  const [open, setOpen] = useState(false);

  if (IS_DEMO || status !== "signed_in") return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Send feedback"
        style={styles.btn}
        hitSlop={8}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.text} />
      </Pressable>
      {/* Mount the sheet only while open — it calls usePathname()/useAuth(), so
          keeping it unmounted keeps this button cheap to place in the nav chrome. */}
      {open && <FeedbackSheet visible onClose={() => setOpen(false)} />}
    </>
  );
}

const makeStyles = (c: Palette) => ({
  // Same 44px circle + border as UserChip's avatar, so the two align in the row.
  btn: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.full,
    backgroundColor: c.surfaceHigh,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
});
