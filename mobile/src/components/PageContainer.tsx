import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useResponsive } from "@/hooks/useResponsive";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { spacing } from "@/constants/theme";

interface Props {
  children: React.ReactNode;
  maxWidth?: number;
  gap?: number;
  style?: ViewStyle;
}

// Wraps a screen's content. On phones it's a plain padded column (pixel-identical
// to the previous layout). On tablet/desktop it caps the width and centers it, so
// content reads as a comfortable column instead of stretching edge-to-edge across
// a wide monitor. Place it as the child of a screen's ScrollView.
export function PageContainer({
  children,
  maxWidth = MAX_CONTENT_WIDTH,
  gap = spacing.md,
  style,
}: Props) {
  const { isTablet } = useResponsive();
  return (
    <View
      style={[
        styles.base,
        { gap },
        isTablet && { maxWidth, width: "100%", alignSelf: "center" },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    padding: spacing.md,
  },
});
