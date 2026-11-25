import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { spacing, radius } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

// The homepage example: a Google Drive-hosted MP4 (shared "anyone with the link").
// Web embeds the Drive preview player inline; native opens the file in the browser,
// since a RN view can't host an iframe.
export const EXAMPLE_VIDEO_ID = "1q-hEpydIN9vVvw0GAs8M7sEVP0MTiJkr";
export const EXAMPLE_VIDEO_PREVIEW_URL = `https://drive.google.com/file/d/${EXAMPLE_VIDEO_ID}/preview`;
export const EXAMPLE_VIDEO_OPEN_URL = `https://drive.google.com/file/d/${EXAMPLE_VIDEO_ID}/view`;

const GOLD = "#d6a94b";
const INK = "#f4f2ea";
const NAVY = "#0e1421";

export function ExampleVideo(): React.JSX.Element {
  if (Platform.OS === "web") {
    return (
      <View style={styles.card} {...sectionAnchor("trust")}>
        {React.createElement("iframe", {
          src: EXAMPLE_VIDEO_PREVIEW_URL,
          title: "Mentible example video",
          allow: "autoplay; fullscreen",
          allowFullScreen: true,
          style: { width: "100%", height: "100%", border: 0 },
        })}
      </View>
    );
  }
  return (
    <Pressable
      style={styles.card}
      onPress={() => Linking.openURL(EXAMPLE_VIDEO_OPEN_URL)}
      accessibilityRole="button"
      accessibilityLabel="Watch the Mentible example video"
      {...sectionAnchor("trust")}
    >
      <Text style={styles.cta}>▶ Watch the example video</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    aspectRatio: 16 / 9,
    backgroundColor: NAVY,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: GOLD,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  cta: {
    color: INK,
    fontSize: 16,
    fontWeight: "600",
  },
});
