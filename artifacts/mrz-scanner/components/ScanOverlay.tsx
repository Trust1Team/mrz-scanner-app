import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, useWindowDimensions, View } from "react-native";

// ─────────────────────────────────────────────────────────────────────────────
// Zone geometry — the MRZ strip lives at the BOTTOM of Belgian eID cards.
// We place the guide window near the bottom of the viewfinder so the user
// simply holds the phone over the bottom edge of the document.
//
// Portrait:  strip at 72 %–94 % of screen height  (~22 % tall)
// Landscape: strip at 55 %–92 % of screen height  (~37 % tall, wider card fit)
// ─────────────────────────────────────────────────────────────────────────────

export interface MRZZoneGeometry {
  topFrac: number;
  bottomFrac: number;
  width: number;
  height: number;
}

export function getMRZZone(screenW: number, screenH: number): MRZZoneGeometry {
  const isLandscape = screenW > screenH;
  // Portrait:  MRZ strip at 72–94 % of screen height
  // Landscape: MRZ strip at 52–86 % — leaves ~14 % (≈100 px) below for controls
  const topFrac    = isLandscape ? 0.52 : 0.72;
  const bottomFrac = isLandscape ? 0.86 : 0.94;
  return {
    topFrac,
    bottomFrac,
    width:  screenW * 0.97,
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
  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const glowAnim     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (scanning && !detected) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 0,    useNativeDriver: true }),
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
          Animated.timing(pulseAnim, { toValue: 1.012, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,     duration: 300, useNativeDriver: true }),
        ])
      );
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1,   duration: 450, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.3, duration: 450, useNativeDriver: true }),
        ])
      );
      pulse.start();
      glow.start();
      return () => { pulse.stop(); glow.stop(); };
    }
  }, [detected, pulseAnim, glowAnim]);

  const borderColor = detected ? "#00FF88" : "#58A6FF";
  const scanLineY   = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, zone.height - 2],
  });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.20] });

  const topH    = SH * zone.topFrac;
  const bottomH = SH * (1 - zone.bottomFrac);
  const rowCount = SW > SH ? 2 : 3;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dim: everything ABOVE the zone */}
      <View style={[styles.dim, { height: topH }]} />

      {/* Dim: everything BELOW the zone */}
      <View style={[styles.dim, { height: bottomH, bottom: 0, position: "absolute", left: 0, right: 0 }]} />

      {/* Label just above the zone */}
      <View style={[styles.labelRow, { top: Math.max(4, topH - 30) }]}>
        <Text style={styles.labelText}>
          {detected ? "✓  MRZ detected — hold still" : "Align the MRZ strip (bottom of card) inside the box"}
        </Text>
      </View>

      {/* The MRZ guide strip */}
      <Animated.View
        style={[
          styles.zone,
          {
            top:        topH,
            width:      zone.width,
            height:     zone.height,
            borderColor,
            transform:  [{ scale: pulseAnim }],
          },
        ]}
      >
        {/* Glow fill on detect */}
        {detected && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: "#00FF88", opacity: glowOpacity }]}
          />
        )}

        {/* MRZ row guides */}
        {Array.from({ length: rowCount }).map((_, i) => (
          <View key={i} style={[styles.mrzRow, { borderColor: `${borderColor}55` }]}>
            <Text style={[styles.mrzRowLabel, { color: `${borderColor}70` }]}>
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<".repeat(4).substring(0, 30)}
            </Text>
          </View>
        ))}

        {/* Corner accents */}
        <View style={[styles.corner, styles.cTL, { borderColor }]} />
        <View style={[styles.corner, styles.cTR, { borderColor }]} />
        <View style={[styles.corner, styles.cBL, { borderColor }]} />
        <View style={[styles.corner, styles.cBR, { borderColor }]} />

        {/* Sweep line */}
        {scanning && !detected && (
          <Animated.View
            style={[styles.scanLine, { backgroundColor: borderColor, transform: [{ translateY: scanLineY }] }]}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: "rgba(0,0,0,0.60)",
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
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.95)",
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
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
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
    letterSpacing: 1.8,
    opacity: 0.45,
  },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.85,
  },
  corner: {
    position: "absolute",
    width: 18,
    height: 18,
    borderWidth: 3,
  },
  cTL: { top: -1, left: -1,  borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius:     8 },
  cTR: { top: -1, right: -1, borderLeftWidth: 0,  borderBottomWidth: 0, borderTopRightRadius:    8 },
  cBL: { bottom: -1, left: -1,  borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius:  8 },
  cBR: { bottom: -1, right: -1, borderLeftWidth: 0,  borderTopWidth: 0, borderBottomRightRadius: 8 },
});
