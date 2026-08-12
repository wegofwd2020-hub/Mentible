import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, LayoutChangeEvent, Text, View } from "react-native";
import { type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GenerateProgressBar({
  phase, elapsedMs, etaHint = "usually 1–3 min",
}: { phase: "queued" | "running"; elapsedMs: number; etaHint?: string }): React.JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => active && setReduceMotion(r));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // The native driver can only animate numeric transforms — it has no access
    // to the parent's measured layout, so it can't resolve percentage strings
    // for `transform`. Wait for a real pixel width from onLayout before
    // starting the loop; a 0-width interpolation would be a no-op anyway.
    if (reduceMotion || trackWidth === 0) return;
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, trackWidth, anim]);

  const label =
    phase === "queued"
      ? `Waiting for a slot… ${mmss(elapsedMs)}`
      : `Generating… ${mmss(elapsedMs)} · ${etaHint}`;

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  // Indeterminate: a ~40%-wide fill sliding across the track (translateX, in
  // numeric px — required for useNativeDriver: true).
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-trackWidth * 0.4, trackWidth * 1.2],
  });

  return (
    <View accessible accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLabel={label}>
      <View style={styles.track} onLayout={onTrackLayout}>
        {reduceMotion ? (
          <View testID="progress-static-fill" style={styles.staticFill} />
        ) : (
          <Animated.View
            testID="progress-sliding-fill"
            style={[styles.slidingFill, trackWidth > 0 && { transform: [{ translateX }] }]}
          />
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  track: { height: 4, borderRadius: 2, backgroundColor: c.border, overflow: "hidden" as const, marginTop: 8 },
  slidingFill: { height: 4, width: "40%" as const, borderRadius: 2, backgroundColor: c.primary },
  staticFill: { height: 4, width: "100%" as const, borderRadius: 2, backgroundColor: c.primary, opacity: 0.5 },
  label: { marginTop: 4, fontSize: 12, color: c.textMuted },
});
