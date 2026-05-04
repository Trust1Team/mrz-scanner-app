/**
 * MRZ Scanner Screen
 *
 * - Native (iOS/Android): Continuous auto-scan loop. Crops to the bottom MRZ
 *   strip (matching the overlay guide), passes through on-device OCR (Google
 *   ML Kit / Apple Vision) and ICAO 9303 parser. No network call is made.
 *
 * - Web: Manual MRZ text input + parser for testing.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { router, useFocusEffect } from "expo-router";
import { ScanOverlay, getMRZZone } from "@/components/ScanOverlay";
import { parseMRZ, extractMRZFromText, ParsedMRZ } from "@/lib/mrz";
import { setLastResult } from "@/lib/resultStore";

// ─────────────────────────────────────────────────────────────────────────────
// On-device OCR — Google ML Kit (Android) / Apple Vision (iOS)
// ─────────────────────────────────────────────────────────────────────────────
async function performLocalOCR(imageUri: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: TextRecognition } = require("@react-native-ml-kit/text-recognition") as {
      default: { recognize: (uri: string) => Promise<{ text: string }> };
    };
    const result = await TextRecognition.recognize(imageUri);
    return result?.text || null;
  } catch (e) {
    console.warn("[MRZ] ML Kit OCR error:", e);
    return null;
  }
}

type ScanPhase = "scanning" | "paused" | "found";

// ─────────────────────────────────────────────────────────────────────────────
// Web-only parser UI
// ─────────────────────────────────────────────────────────────────────────────
function WebParserUI() {
  const insets = useSafeAreaInsets();
  const [manualInput, setManualInput] = useState("");

  const insertSample = (type: "passport" | "id") => {
    if (type === "passport") {
      setManualInput(
        "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<1"
      );
    } else {
      setManualInput(
        "I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<"
      );
    }
  };

  const handleParse = useCallback(() => {
    if (!manualInput.trim()) return;
    const lines = extractMRZFromText(manualInput.trim());
    if (!lines) {
      Alert.alert(
        "Parse Error",
        "Could not detect MRZ lines. Lines must be 30, 36, or 44 characters of uppercase letters, digits, and '<'."
      );
      return;
    }
    const parsed = parseMRZ(lines);
    if (!parsed) {
      Alert.alert("Parse Error", "Could not parse the MRZ. Check the format and try again.");
      return;
    }
    setLastResult({ parsed, thumbnailUri: null, scannedAt: new Date() });
    router.push("/result");
  }, [manualInput]);

  return (
    <View style={[webStyles.root, { paddingTop: insets.top + 67, paddingBottom: insets.bottom + 34 }]}>
      <ScrollView
        style={webStyles.scroll}
        contentContainerStyle={webStyles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={webStyles.header}>
          <View style={webStyles.iconBox}>
            <Feather name="credit-card" size={32} color="#00FF88" />
          </View>
          <Text style={webStyles.title}>MRZ Scanner</Text>
          <Text style={webStyles.subtitle}>
            Paste MRZ text below to parse an ID document or passport.{"\n"}
            On a real device, scanning happens automatically via the camera.
          </Text>
        </View>

        <View style={webStyles.sampleSection}>
          <Text style={webStyles.sampleLabel}>Load sample data:</Text>
          <View style={webStyles.sampleRow}>
            <Pressable
              testID="sample-passport"
              onPress={() => insertSample("passport")}
              style={({ pressed }) => [webStyles.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="book-open" size={14} color="#00FF88" />
              <Text style={webStyles.sampleBtnText}>Passport (TD3)</Text>
            </Pressable>
            <Pressable
              testID="sample-id"
              onPress={() => insertSample("id")}
              style={({ pressed }) => [webStyles.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="credit-card" size={14} color="#00FF88" />
              <Text style={webStyles.sampleBtnText}>ID Card (TD1)</Text>
            </Pressable>
          </View>
        </View>

        <View style={webStyles.inputSection}>
          <Text style={webStyles.inputLabel}>MRZ Lines</Text>
          <TextInput
            testID="mrz-text-input"
            style={webStyles.input}
            value={manualInput}
            onChangeText={setManualInput}
            multiline
            numberOfLines={5}
            placeholder={
              "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<1"
            }
            placeholderTextColor="#444"
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
          />
          <Text style={webStyles.formatHint}>
            Supported: TD3 (2×44), TD1 (3×30), TD2 (2×36) — uppercase + digits + &lt; filler
          </Text>
        </View>

        <Pressable
          testID="parse-button"
          onPress={handleParse}
          style={({ pressed }) => [webStyles.parseBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="search" size={18} color="#0D1117" />
          <Text style={webStyles.parseBtnText}>Parse MRZ</Text>
        </Pressable>

        <View style={webStyles.infoBox}>
          <Feather name="info" size={14} color="#58A6FF" />
          <Text style={webStyles.infoText}>
            Camera scanning runs on-device (no network required) using Google ML Kit on Android and Apple Vision on iOS.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const webStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D1117" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32, gap: 20 },
  header: { alignItems: "center", paddingVertical: 16, gap: 10 },
  iconBox: {
    width: 72, height: 72, borderRadius: 18,
    backgroundColor: "rgba(0,255,136,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "700" as const, letterSpacing: 0.3 },
  subtitle: { color: "#8B949E", fontSize: 14, textAlign: "center", lineHeight: 21 },
  sampleSection: { gap: 10 },
  sampleLabel: { color: "#8B949E", fontSize: 13 },
  sampleRow: { flexDirection: "row", gap: 10 },
  sampleBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, backgroundColor: "#161B22", borderWidth: 1, borderColor: "#30363D",
    borderRadius: 10, paddingVertical: 10,
  },
  sampleBtnText: { color: "#00FF88", fontSize: 13, fontWeight: "500" as const },
  inputSection: { gap: 8 },
  inputLabel: { color: "#C9D1D9", fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.5 },
  input: {
    backgroundColor: "#161B22", borderRadius: 12, borderWidth: 1, borderColor: "#30363D",
    color: "#FFFFFF", fontSize: 11, padding: 14, minHeight: 120,
    letterSpacing: 0.3, textAlignVertical: "top",
  },
  formatHint: { color: "#8B949E", fontSize: 11, lineHeight: 18 },
  parseBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#00FF88", borderRadius: 14, paddingVertical: 15,
  },
  parseBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
  infoBox: {
    flexDirection: "row", gap: 10,
    backgroundColor: "rgba(88,166,255,0.08)", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(88,166,255,0.2)",
    padding: 12, alignItems: "flex-start",
  },
  infoText: { color: "#8B949E", fontSize: 12, lineHeight: 18, flex: 1 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Native continuous auto-scanner (iOS / Android)
// ─────────────────────────────────────────────────────────────────────────────
function NativeScannerUI() {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const isLandscape = screenW > screenH;

  const [permission, requestPermission] = useCameraPermissions();
  const [torchMode, setTorchMode] = useState<"off" | "manual">("off");
  const torchOn = torchMode === "manual";

  const [scanPhase, setScanPhase] = useState<ScanPhase>("scanning");
  const scanPhaseRef = useRef<ScanPhase>("scanning");
  const [cameraReady, setCameraReady] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [hint, setHint] = useState("Initialising camera…");

  const hintAnim        = useRef(new Animated.Value(1)).current;
  const cameraRef       = useRef<CameraView | null>(null);
  const captureActiveRef   = useRef(false);
  const consecutiveHitsRef = useRef(0);

  // ── Hint update with fade ───────────────────────────────────────────────────
  const updateHint = useCallback(
    (text: string) => {
      Animated.sequence([
        Animated.timing(hintAnim, { toValue: 0, duration: 80,  useNativeDriver: true }),
        Animated.timing(hintAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setHint(text), 80);
    },
    [hintAnim]
  );

  // ── Single guarded capture ─────────────────────────────────────────────────
  const capture = useCallback(async (opts: {
    quality: number;
    base64: boolean;
    skipProcessing: boolean;
  }) => {
    if (!cameraRef.current || captureActiveRef.current) return null;
    captureActiveRef.current = true;
    try {
      return await cameraRef.current.takePictureAsync(opts);
    } catch (e) {
      console.warn("[MRZ] takePictureAsync error:", e);
      return null;
    } finally {
      captureActiveRef.current = false;
    }
  }, []);

  // ── Navigate to result ───────────────────────────────────────────────────────
  const showResultScreen = useCallback((parsed: ParsedMRZ, thumbnailUri?: string | null) => {
    scanPhaseRef.current = "found";
    setScanPhase("found");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setLastResult({ parsed, thumbnailUri: thumbnailUri ?? null, scannedAt: new Date() });
    router.push("/result");
  }, []);

  // ── Continuous scan loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (!permission?.granted || !cameraReady || scanPhase !== "scanning") return;

    let cancelled = false;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Zone fractions — kept in sync with ScanOverlay / getMRZZone
    // Add small margin outside the zone so slightly off-centre cards still hit.
    const zone = getMRZZone(screenW, screenH);
    const cropTopFrac = Math.max(0, zone.topFrac - 0.03);
    const cropBotFrac = Math.min(1, zone.bottomFrac + 0.02);

    const loop = async () => {
      await delay(500); // let camera exposure settle

      while (!cancelled && scanPhaseRef.current === "scanning") {
        const photo = await capture({ quality: 0.92, base64: false, skipProcessing: false });

        if (photo) {
          // ── Crop to MRZ strip ──────────────────────────────────────────────
          // Some Android devices return photo.width/height in *sensor* (pre-EXIF)
          // coordinates even when skipProcessing=false.  We detect this by
          // comparing the image orientation to the current screen orientation
          // and swap the axes when they disagree, so the crop fractions always
          // map to the correct physical dimension.
          let ocrUri: string | null = null;
          try {
            const rawW = photo.width  ?? 1080;
            const rawH = photo.height ?? 1440;
            const screenIsPortrait = screenH > screenW;
            const imageIsPortrait  = rawH > rawW;
            const displayW = screenIsPortrait === imageIsPortrait ? rawW : rawH;
            const displayH = screenIsPortrait === imageIsPortrait ? rawH : rawW;
            const cropTop = Math.floor(displayH * cropTopFrac);
            const cropH   = Math.max(1, Math.floor(displayH * (cropBotFrac - cropTopFrac)));
            const targetW = Math.min(displayW, 1600);
            const manipulated = await ImageManipulator.manipulateAsync(
              photo.uri,
              [
                { crop: { originX: 0, originY: cropTop, width: displayW, height: cropH } },
                { resize: { width: targetW } },
              ],
              { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
            );
            ocrUri = manipulated.uri;
          } catch {
            ocrUri = photo.uri;
          }

          const ocrText = ocrUri ? await performLocalOCR(ocrUri) : null;
          console.log("[MRZ] ocr:", JSON.stringify(ocrText));

          if (ocrText) {
            const lines = extractMRZFromText(ocrText);
            if (lines) {
              const parsed = parseMRZ(lines);
              if (parsed) {
                consecutiveHitsRef.current++;
                console.log(`[MRZ] hit ${consecutiveHitsRef.current}/2 ${parsed.format} valid=${parsed.valid}`);
                if (consecutiveHitsRef.current >= 2) {
                  showResultScreen(parsed, photo.uri);
                  return;
                }
                updateHint("MRZ detected — hold still…");
                await delay(500);
                continue;
              } else {
                consecutiveHitsRef.current = 0;
                updateHint("Hold steadier — almost there");
              }
            } else {
              consecutiveHitsRef.current = 0;
              updateHint("Point at the bottom MRZ strip");
            }
          } else {
            consecutiveHitsRef.current = 0;
            updateHint("No text found — aim at the MRZ zone");
          }
        }

        // 800 ms between frames — fast enough to respond, long enough for focus
        await delay(800);
      }
    };

    loop();
    return () => { cancelled = true; };
  }, [permission?.granted, cameraReady, scanPhase, capture, updateHint, showResultScreen, screenW, screenH]);

  // ── Auto-torch: single brightness check at 1 s after camera ready ──────────
  useEffect(() => {
    if (!permission?.granted || !cameraReady) return;
    const check = async () => {
      const photo = await capture({ quality: 0.05, base64: true, skipProcessing: true });
      if (!photo) return;
      const len = photo.base64?.length ?? 0;
      if (len > 0 && len < 3500 && torchMode === "off") {
        setTorchMode("manual"); // auto-enable torch in dark scenes
        updateHint("Low light — torch on");
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    };
    const t = setTimeout(check, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted, cameraReady]);

  // ── Restore scan state when returning from result screen ─────────────────
  useFocusEffect(
    useCallback(() => {
      if (scanPhaseRef.current === "found") {
        captureActiveRef.current  = false;
        consecutiveHitsRef.current = 0;
        scanPhaseRef.current = "scanning";
        setScanPhase("scanning");
        updateHint("Hold the MRZ strip inside the box");
      }
    }, [updateHint])
  );

  const togglePause = useCallback(() => {
    if (scanPhaseRef.current === "scanning") {
      scanPhaseRef.current = "paused";
      setScanPhase("paused");
      updateHint("Paused — tap ▶ to resume");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      captureActiveRef.current  = false;
      consecutiveHitsRef.current = 0;
      scanPhaseRef.current = "scanning";
      setScanPhase("scanning");
      updateHint("Scanning resumed");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [updateHint]);

  const toggleTorch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTorchMode((prev) => (prev === "off" ? "manual" : "off"));
  }, []);

  const handleManualParse = useCallback(() => {
    if (!manualInput.trim()) return;
    const lines = extractMRZFromText(manualInput.trim());
    if (!lines) {
      Alert.alert("Parse Error", "Could not detect MRZ lines. Lines must be 30, 36, or 44 characters.");
      return;
    }
    const parsed = parseMRZ(lines);
    if (!parsed) {
      Alert.alert("Parse Error", "Could not parse the MRZ. Check the format.");
      return;
    }
    setShowManualEntry(false);
    setManualInput("");
    showResultScreen(parsed);
  }, [manualInput, showResultScreen]);

  const insertSample = useCallback((type: "passport" | "id") => {
    if (type === "passport") {
      setManualInput("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<1");
    } else {
      setManualInput("I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<"    );
    }
  }, []);

  // ── Permission screens ──────────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={[s.centered, { backgroundColor: "#000" }]}>
        <ActivityIndicator color="#00FF88" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[s.permissionContainer, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
        <View style={s.permissionIcon}>
          <Feather name="camera" size={48} color="#00FF88" />
        </View>
        <Text style={s.permissionTitle}>Camera Access Required</Text>
        <Text style={s.permissionSubtitle}>
          The camera is used to auto-scan MRZ zones on ID documents and passports.
        </Text>
        {!permission.canAskAgain ? (
          <Pressable
            style={s.permissionBtn}
            onPress={() => {
              const Linking = require("expo-linking");
              Linking.openSettings().catch(() => {});
            }}
          >
            <Text style={s.permissionBtnText}>Open Settings</Text>
          </Pressable>
        ) : (
          <Pressable style={s.permissionBtn} onPress={requestPermission}>
            <Text style={s.permissionBtnText}>Grant Camera Access</Text>
          </Pressable>
        )}
        <Pressable
          style={[s.manualBtn, { marginTop: 12 }]}
          onPress={() => setShowManualEntry(true)}
        >
          <Feather name="edit-2" size={16} color="#8B949E" />
          <Text style={s.manualBtnText}>Test with manual input</Text>
        </Pressable>
        <ManualEntryModal
          visible={showManualEntry}
          value={manualInput}
          onChangeText={setManualInput}
          onClose={() => { setShowManualEntry(false); setManualInput(""); }}
          onParse={handleManualParse}
          onInsertSample={insertSample}
        />
      </View>
    );
  }

  const isScanning = scanPhase === "scanning";
  const isFound    = scanPhase === "found";

  // Zone geometry — used for hint positioning so the hint sits just above the box
  const zone = getMRZZone(screenW, screenH);
  // Distance from bottom of screen to the top edge of the zone
  const hintBottom = screenH * (1 - zone.topFrac) + (isLandscape ? 10 : 18);

  return (
    <View style={s.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
        autofocus="on"
        onCameraReady={() => {
          setCameraReady(true);
          updateHint("Align the MRZ strip inside the box");
        }}
      />

      <ScanOverlay scanning={isScanning} detected={isFound} />

      {/* Top bar — title + torch */}
      <View
        style={[
          s.topBar,
          {
            paddingTop:   isLandscape ? insets.top + 6  : insets.top + 10,
            paddingLeft:  insets.left  + (isLandscape ? 16 : 20),
            paddingRight: insets.right + (isLandscape ? 16 : 20),
          },
        ]}
      >
        <Text style={[s.appTitle, isLandscape && s.appTitleSmall]}>MRZ Scanner</Text>
        <Pressable
          testID="torch-button"
          onPress={toggleTorch}
          style={({ pressed }) => [
            s.iconBtn,
            {
              backgroundColor: torchOn ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.12)",
              borderColor: torchOn ? "#00FF88" : "transparent",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name={torchOn ? "zap" : "zap-off"} size={20} color={torchOn ? "#00FF88" : "#FFFFFF"} />
        </Pressable>
      </View>

      {/* Hint pill — floats just above the MRZ guide box */}
      <Animated.View
        style={[s.hintContainer, { bottom: hintBottom, opacity: hintAnim }]}
        pointerEvents="none"
      >
        <View style={s.hintBubble}>
          <Text style={s.hintText}>{hint}</Text>
        </View>
      </Animated.View>

      {/* Bottom controls — compact in landscape to fit below the zone */}
      <View
        style={[
          s.bottomControls,
          {
            paddingBottom:  insets.bottom + (isLandscape ? 6 : 16),
            paddingLeft:    insets.left   + (isLandscape ? 16 : 0),
            paddingRight:   insets.right  + (isLandscape ? 16 : 0),
          },
        ]}
      >
        <Pressable
          testID="manual-entry-button"
          onPress={() => setShowManualEntry(true)}
          style={({ pressed }) => [
            isLandscape ? s.sideBtnSmall : s.sideBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="edit-2" size={isLandscape ? 16 : 20} color="#FFFFFF" />
        </Pressable>

        <Pressable
          testID="pause-resume-button"
          onPress={togglePause}
          disabled={isFound}
          style={({ pressed }) => [
            isLandscape ? s.pauseBtnSmall : s.pauseBtn,
            {
              opacity: pressed || isFound ? 0.5 : 1,
              backgroundColor: isScanning ? "rgba(255,255,255,0.18)" : "rgba(0,255,136,0.25)",
              borderColor: isScanning ? "rgba(255,255,255,0.4)" : "#00FF88",
            },
          ]}
        >
          <Feather
            name={isScanning ? "pause" : "play"}
            size={isLandscape ? 20 : 26}
            color={isScanning ? "#FFFFFF" : "#00FF88"}
          />
        </Pressable>

        <View style={isLandscape ? s.sideBtnSmall : s.sideBtn} />
      </View>

      <ManualEntryModal
        visible={showManualEntry}
        value={manualInput}
        onChangeText={setManualInput}
        onClose={() => { setShowManualEntry(false); setManualInput(""); }}
        onParse={handleManualParse}
        onInsertSample={insertSample}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Manual Entry Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ManualEntryModalProps {
  visible: boolean;
  value: string;
  onChangeText: (text: string) => void;
  onClose: () => void;
  onParse: () => void;
  onInsertSample: (type: "passport" | "id") => void;
}

function ManualEntryModal({ visible, value, onChangeText, onClose, onParse, onInsertSample }: ManualEntryModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[m.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={m.header}>
          <Text style={m.title}>Manual MRZ Entry</Text>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Feather name="x" size={22} color="#8B949E" />
          </Pressable>
        </View>
        <Text style={m.subtitle}>Paste MRZ text or load a sample to test the parser.</Text>
        <View style={m.sampleRow}>
          <Text style={m.sampleLabel}>Sample:</Text>
          <Pressable
            testID="sample-passport"
            onPress={() => onInsertSample("passport")}
            style={({ pressed }) => [m.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={m.sampleBtnText}>Passport (TD3)</Text>
          </Pressable>
          <Pressable
            testID="sample-id"
            onPress={() => onInsertSample("id")}
            style={({ pressed }) => [m.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={m.sampleBtnText}>ID Card (TD1)</Text>
          </Pressable>
        </View>
        <TextInput
          testID="mrz-text-input"
          style={m.input}
          value={value}
          onChangeText={onChangeText}
          multiline
          numberOfLines={5}
          placeholder={"P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<1"}
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
        />
        <Text style={m.formatHint}>
          • Passport (TD3): 2 lines × 44 chars{"\n"}
          • ID Card (TD1): 3 lines × 30 chars{"\n"}
          • Older docs (TD2): 2 lines × 36 chars{"\n"}
          Use uppercase + digits + {"<"} as filler
        </Text>
        <Pressable
          testID="parse-button"
          onPress={onParse}
          style={({ pressed }) => [m.parseBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="check" size={18} color="#0D1117" />
          <Text style={m.parseBtnText}>Parse MRZ</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D1117", paddingHorizontal: 20, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" as const },
  subtitle: { color: "#8B949E", fontSize: 13, lineHeight: 20 },
  sampleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sampleLabel: { color: "#8B949E", fontSize: 13 },
  sampleBtn: { backgroundColor: "#21262D", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  sampleBtnText: { color: "#00FF88", fontSize: 13, fontWeight: "500" as const },
  input: {
    backgroundColor: "#161B22", borderRadius: 12, borderWidth: 1, borderColor: "#30363D",
    color: "#FFFFFF", fontSize: 11, padding: 14, minHeight: 120,
    letterSpacing: 0.3, textAlignVertical: "top",
  },
  formatHint: { color: "#8B949E", fontSize: 12, lineHeight: 20 },
  parseBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#00FF88", borderRadius: 14, paddingVertical: 15,
  },
  parseBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
});

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerScreen() {
  if (Platform.OS === "web") return <WebParserUI />;
  return <NativeScannerUI />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  appTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" as const },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },

  hintContainer: {
    position: "absolute",
    left: 0, right: 0,
    alignItems: "center",
  },
  hintBubble: {
    backgroundColor: "rgba(0,0,0,0.70)",
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
  },
  hintText: { color: "#FFFFFF", fontSize: 13, fontWeight: "500" as const },

  bottomControls: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 40,
  },
  sideBtn: {
    width: 48, height: 48, alignItems: "center", justifyContent: "center",
    borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)",
  },
  sideBtnSmall: {
    width: 36, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)",
  },
  pauseBtn: {
    width: 66, height: 66, borderRadius: 33,
    borderWidth: 2, alignItems: "center", justifyContent: "center",
  },
  pauseBtnSmall: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, alignItems: "center", justifyContent: "center",
  },
  appTitleSmall: { fontSize: 14 },

  permissionContainer: {
    flex: 1, backgroundColor: "#0D1117",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32, gap: 12,
  },
  permissionIcon: {
    width: 96, height: 96, borderRadius: 24,
    backgroundColor: "rgba(0,255,136,0.12)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  permissionTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" as const, textAlign: "center" },
  permissionSubtitle: { color: "#8B949E", fontSize: 15, textAlign: "center", lineHeight: 22 },
  permissionBtn: {
    backgroundColor: "#00FF88", paddingHorizontal: 32,
    paddingVertical: 14, borderRadius: 14, marginTop: 8,
  },
  permissionBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
  manualBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10 },
  manualBtnText: { color: "#8B949E", fontSize: 14 },
});
