import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";
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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => active && setReduceMotion(r));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, anim]);

  const label =
    phase === "queued"
      ? `Waiting for a slot… ${mmss(elapsedMs)}`
      : `Generating… ${mmss(elapsedMs)} · ${etaHint}`;

  // Indeterminate: a partial fill sliding across the track (translateX).
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: ["-40%", "160%"] });

  return (
    <View accessible accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLabel={label}>
      <View style={styles.track}>
        {reduceMotion ? (
          <View style={styles.staticFill} />
        ) : (
          <Animated.View style={[styles.slidingFill, { transform: [{ translateX }] }]} />
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
