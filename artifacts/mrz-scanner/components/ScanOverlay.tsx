import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, useWindowDimensions, View } from "react-native";

// ─────────────────────────────────────────────────────────────────────────────
// Zone geometry — exported so the capture loop can crop to exactly match what
// the user sees on screen.
// ─────────────────────────────────────────────────────────────────────────────

export interface MRZZoneGeometry {
  topFrac: number;
  bottomFrac: number;
  horizontalPad: number;
  width: number;    // screen pixels
  height: number;   // screen pixels
}

/**
 * Compute the MRZ zone position that fits the current screen orientation.
 *
 * Portrait  (H > W) — zone spans 44 %–74 % of screen height, 95 % of width.
 * Landscape (W > H) — the screen is much shorter so we use a wider, more
 *   central band: 25 %–80 % of screen height, 95 % of width.
 */
export function getMRZZone(screenW: number, screenH: number): MRZZoneGeometry {
  const isLandscape = screenW > screenH;
  const topFrac = isLandscape ? 0.25 : 0.44;
  const bottomFrac = isLandscape ? 0.80 : 0.74;
  const horizontalPad = screenW * 0.025;
  return {
    topFrac,
    bottomFrac,
    horizontalPad,
    width: screenW * 0.95,
    height: screenH * (bottomFrac - topFrac),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

interface ScanOverlayProps {
  scanning: boolean;
  detected: boolean;
}

export function ScanOverlay({ scanning, detected }: ScanOverlayProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  const zone = getMRZZone(SW, SH);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (scanning && !detected) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [scanning, detected, scanLineAnim]);

  useEffect(() => {
    if (detected) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.015, duration: 350, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        ])
      );
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      glow.start();
      return () => { pulse.stop(); glow.stop(); };
    }
  }, [detected, pulseAnim, glowAnim]);

  const borderColor = detected ? "#00FF88" : "#58A6FF";
  const scanLineY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, zone.height - 2],
  });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.18] });

  const topH = SH * zone.topFrac;
  const bottomH = SH * (1 - zone.bottomFrac);

  // Number of MRZ row guides: 2 in landscape (less vertical room), 3 in portrait
  const rowCount = SW > SH ? 2 : 3;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dim area above the zone */}
      <View style={[styles.dim, { height: topH }]} />

      {/* Dim area below the zone */}
      <View style={[styles.dim, { height: bottomH, bottom: 0, position: "absolute", left: 0, right: 0 }]} />

      {/* Label above the zone */}
      <View style={[styles.labelRow, { top: Math.max(4, topH - 32) }]}>
        <Text style={styles.labelText}>
          {detected ? "✓  MRZ detected!" : "Align MRZ text lines inside the strip"}
        </Text>
      </View>

      {/* The animated MRZ zone strip */}
      <Animated.View
        style={[
          styles.zone,
          {
            top: topH,
            width: zone.width,
            height: zone.height,
            borderColor,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        {/* Glow fill when detected */}
        {detected && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: "#00FF88", opacity: glowOpacity }]}
          />
        )}

        {/* MRZ row guides */}
        {Array.from({ length: rowCount }).map((_, i) => (
          <View key={i} style={[styles.mrzRow, { borderColor: `${borderColor}60` }]}>
            <Text style={[styles.mrzRowLabel, { color: `${borderColor}80` }]}>
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<".repeat(3).substring(0, 22)}
            </Text>
          </View>
        ))}

        {/* Corner accents */}
        <View style={[styles.corner, styles.cTL, { borderColor }]} />
        <View style={[styles.corner, styles.cTR, { borderColor }]} />
        <View style={[styles.corner, styles.cBL, { borderColor }]} />
        <View style={[styles.corner, styles.cBR, { borderColor }]} />

        {/* Animated sweep line */}
        {scanning && !detected && (
          <Animated.View
            style={[styles.scanLine, { backgroundColor: borderColor, transform: [{ translateY: scanLineY }] }]}
          />
        )}
      </Animated.View>

      {/* Type hint below the zone */}
      <View style={[styles.typeRow, { top: topH + zone.height + 6 }]}>
        <Text style={styles.typeText}>TD3 passport · TD1/TD2 ID card</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  labelRow: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  labelText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  zone: {
    position: "absolute",
    alignSelf: "center",
    borderWidth: 2,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "space-evenly",
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  mrzRow: {
    flex: 1,
    marginVertical: 2,
    borderWidth: 1,
    borderRadius: 3,
    justifyContent: "center",
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  mrzRowLabel: {
    fontSize: 9,
    fontFamily: "Courier",
    letterSpacing: 1.5,
    opacity: 0.5,
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.9,
  },
  corner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderWidth: 3,
  },
  cTL: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cTR: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  cBL: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  cBR: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  typeRow: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  typeText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
