import React from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SvgXml } from "react-native-svg";
import { typography } from "@/constants/theme";

// Render a vector cover. On web, react-native-svg's SvgXml parser chokes on the
// features our editorial cover SVGs use (embedded <style>, CSS classes,
// gradients) and renders blank, so hand the markup to the browser's own SVG
// engine. We render a real DOM <img> (react-native-web's <Image> paints data
// URIs as a CSS background, which silently fails for SVG data URIs — it showed
// a blank field) with a base64 data URL. On native, keep SvgXml — RN's Image
// can't render SVG. Mirrors the iframe-on-web / WebView-on-native split in
// LessonRenderer.
function VectorCover({ svg }: { svg: string }) {
  if (Platform.OS === "web") {
    // base64 (UTF-8 safe) is the most robust data-URI form for <img>.
    const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    return React.createElement("img", {
      src: uri,
      alt: "",
      style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
    });
  }
  return <SvgXml xml={svg} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />;
}

// In-app book cover. Renders the real cover when available — a raster thumbnail
// (coverUri, e.g. a compiled artifact's cover) or a vector cover (coverSvg, e.g.
// extracted from an imported EPUB). Otherwise falls back to a brand-aligned
// placeholder: a deep-indigo field with a green growth mark over a light band.
export function BookCover({
  title,
  badge,
  size = "thumb",
  coverUri,
  coverSvg,
}: {
  title: string;
  badge?: string; // small label, e.g. "EPUB3" or "12/16"
  size?: "thumb" | "large";
  coverUri?: string; // raster cover (file:// path or data: URL)
  coverSvg?: string; // vector cover markup
}) {
  const large = size === "large";
  const badgeEl = badge ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{badge}</Text>
    </View>
  ) : null;

  if (coverUri || coverSvg) {
    return (
      <View
        style={[styles.cover, large ? styles.large : styles.thumb]}
        accessibilityLabel={`Cover: ${title}`}
      >
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <VectorCover svg={coverSvg as string} />
        )}
        {badgeEl}
      </View>
    );
  }

  return (
    <View style={[styles.cover, large ? styles.large : styles.thumb]} accessibilityLabel={`Cover: ${title}`}>
      <View style={styles.top}>
        <Ionicons name="trending-up" size={large ? 56 : 32} color="#34d27e" />
      </View>
      <View style={[styles.bottom, large && styles.bottomLarge]}>
        <View style={styles.rule} />
        <Text style={[styles.title, large && styles.titleLarge]} numberOfLines={large ? 4 : 3}>
          {title}
        </Text>
      </View>
      {badgeEl}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#312a8c",
    elevation: 3,
  },
  thumb: { width: "100%" },
  large: { width: 150 },
  image: { width: "100%", height: "100%" },
  top: {
    flex: 0.55,
    backgroundColor: "#312a8c",
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: {
    flex: 0.45,
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 6,
  },
  bottomLarge: { paddingHorizontal: 16, paddingTop: 14 },
  rule: { width: 22, height: 4, borderRadius: 2, backgroundColor: "#16a34a" },
  title: {
    color: "#1e1b4b",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontWeight: "700",
    fontSize: typography.sizeSm,
    lineHeight: 18,
  },
  titleLarge: { fontSize: typography.sizeMd, lineHeight: 22 },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: "#ffffff", fontSize: 10, fontWeight: "700" },
});
