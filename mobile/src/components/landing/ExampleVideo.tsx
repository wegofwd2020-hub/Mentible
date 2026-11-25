import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { spacing, radius } from "@/constants/theme";
import { sectionAnchor } from "./anchor";

// The homepage example video, hosted with the site at mobile/public/media/. Importing it
// as an asset lets Expo resolve the right URL for each deploy (mentible.app root and
// mambakkam.net/app/mentible). Web plays it in a native <video> at 25% volume.
const EXAMPLE_VIDEO = Asset.fromModule(require("../../../public/media/mentible-example.mp4"));
export const EXAMPLE_VIDEO_VOLUME = 0.25;

// Native can't use an HTML <video>, so it opens the same file in the browser via Drive.
const EXAMPLE_VIDEO_OPEN_URL = "https://drive.google.com/file/d/1q-hEpydIN9vVvw0GAs8M7sEVP0MTiJkr/view";

const GOLD = "#d6a94b";
const INK = "#f4f2ea";
const NAVY = "#0e1421";

// Ref callback: the volume must be set on the DOM element; <video> has no volume prop.
function setDefaultVolume(el: HTMLVideoElement | null): void {
  if (el) el.volume = EXAMPLE_VIDEO_VOLUME;
}

export function ExampleVideo(): React.JSX.Element {
  if (Platform.OS === "web") {
    return (
      <View style={styles.card} {...sectionAnchor("trust")}>
        {React.createElement("video", {
          src: EXAMPLE_VIDEO.uri,
          controls: true,
          playsInline: true,
          preload: "metadata",
          ref: setDefaultVolume,
          "aria-label": "Mentible example video",
          style: { width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" },
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
