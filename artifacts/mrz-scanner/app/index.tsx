/**
 * MRZ Scanner Screen
 *
 * - Native (iOS/Android): Continuous auto-scan loop. Camera captures a full
 *   frame, resizes it for performance, and passes the URI to the on-device
 *   OCR engine (Google ML Kit on Android, Apple Vision on iOS) via
 *   @react-native-ml-kit/text-recognition. No network call is made.
 *   The ICAO 9303 parser validates the result.
 *
 * - Web: Camera permission is not available in an iframe. Renders a direct MRZ
 *   parser UI with manual text input and sample data instead.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
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
import { ScanOverlay } from "@/components/ScanOverlay";
import { parseMRZ, extractMRZFromText, ParsedMRZ } from "@/lib/mrz";
import { setLastResult } from "@/lib/resultStore";

// ─────────────────────────────────────────────────────────────────────────────
// On-device OCR — Google ML Kit (Android) / Apple Vision (iOS)
// ─────────────────────────────────────────────────────────────────────────────
// Runs entirely on-device. Takes an image URI (from expo-image-manipulator),
// returns the full recognized text string with line breaks preserved, or null.
// Uses a dynamic require so the web bundle doesn't try to resolve the native
// module (the function is only ever called in NativeScannerUI on iOS/Android).
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

// ─────────────────────────────────────────────────────────────────────────────
// Brightness estimation via tiny JPEG capture
// ─────────────────────────────────────────────────────────────────────────────
// Dark scenes compress to smaller JPEGs because pixel values are uniform.
// Empirical threshold at quality 0.05: < 3 500 chars → too dark.
const DARK_THRESHOLD = 3500;

type ScanPhase = "scanning" | "paused" | "found";

// ─────────────────────────────────────────────────────────────────────────────
// Web-only parser UI (no camera, just the MRZ parser for testing)
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

  const handleScanAgain = useCallback(() => {
    setManualInput("");
  }, []);

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
            Camera scanning runs on-device (no network required) using Google ML Kit on Android and Apple Vision on iOS. Install the dev build on your phone to use it — see the EAS setup instructions.
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
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "rgba(0,255,136,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "700" as const, letterSpacing: 0.3 },
  subtitle: { color: "#8B949E", fontSize: 14, textAlign: "center", lineHeight: 21 },
  sampleSection: { gap: 10 },
  sampleLabel: { color: "#8B949E", fontSize: 13 },
  sampleRow: { flexDirection: "row", gap: 10 },
  sampleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#161B22",
    borderWidth: 1,
    borderColor: "#30363D",
    borderRadius: 10,
    paddingVertical: 10,
  },
  sampleBtnText: { color: "#00FF88", fontSize: 13, fontWeight: "500" as const },
  inputSection: { gap: 8 },
  inputLabel: { color: "#C9D1D9", fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.5 },
  input: {
    backgroundColor: "#161B22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363D",
    color: "#FFFFFF",
    fontSize: 11,
    padding: 14,
    minHeight: 120,
    letterSpacing: 0.3,
    textAlignVertical: "top",
  },
  formatHint: { color: "#8B949E", fontSize: 11, lineHeight: 18 },
  parseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#00FF88",
    borderRadius: 14,
    paddingVertical: 15,
  },
  parseBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(88,166,255,0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(88,166,255,0.2)",
    padding: 12,
    alignItems: "flex-start",
  },
  infoText: { color: "#8B949E", fontSize: 12, lineHeight: 18, flex: 1 },
  backdrop: { flex: 1 },
  resultWrapper: { position: "absolute", bottom: 0, left: 0, right: 0 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Native continuous auto-scanner (iOS / Android)
// ─────────────────────────────────────────────────────────────────────────────
function NativeScannerUI() {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  const [permission, requestPermission] = useCameraPermissions();

  // Torch: 'off' | 'manual' | 'auto'
  const [torchMode, setTorchMode] = useState<"off" | "manual" | "auto">("off");
  const torchOn = torchMode !== "off";

  // Scan state — ref mirrors state so async loops can read latest value
  const [scanPhase, setScanPhase] = useState<ScanPhase>("scanning");
  const scanPhaseRef = useRef<ScanPhase>("scanning");

  const [frameCount, setFrameCount] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [lastCaptureUri, setLastCaptureUri] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const [result, setResult] = useState<ParsedMRZ | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [hint, setHint] = useState("Initialising camera…");
  const [lightStatus, setLightStatus] = useState<"unknown" | "dark" | "ok">("unknown");

  const slideAnim = useRef(new Animated.Value(600)).current;
  const hintAnim = useRef(new Animated.Value(1)).current;
  const captureFlashAnim = useRef(new Animated.Value(0)).current;
  // CameraView is a class component — ref gives the class instance, which
  // exposes takePictureAsync (not takePicture on the inner native ref).
  const cameraRef = useRef<CameraView | null>(null);

  // Single mutex shared by BOTH the scan loop and the brightness check.
  // This prevents two takePictureAsync() calls from overlapping.
  const captureActiveRef = useRef(false);

  // Two consecutive valid parses required before navigating.
  // Prevents false positives from a single blurry/partial OCR frame.
  const consecutiveHitsRef = useRef(0);

  // ── Hint update with fade ───────────────────────────────────────────────────
  const updateHint = useCallback(
    (text: string) => {
      Animated.sequence([
        Animated.timing(hintAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
        Animated.timing(hintAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setHint(text), 100);
    },
    [hintAnim]
  );

  // ── Single guarded capture ─────────────────────────────────────────────────
  // Returns null if camera isn't ready or a capture is already in flight.
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

  // ── Result navigation ────────────────────────────────────────────────────────
  const showResultSheet = useCallback(
    (parsed: ParsedMRZ, thumbnailUri?: string | null) => {
      scanPhaseRef.current = "found";
      setScanPhase("found");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLastResult({ parsed, thumbnailUri: thumbnailUri ?? null, scannedAt: new Date() });
      router.push("/result");
    },
    []
  );

  const hideResultSheet = useCallback(() => {
    setShowResult(false);
    setResult(null);
  }, []);

  // ── Continuous scan loop ────────────────────────────────────────────────────
  // Uses a simple async while-loop with a `cancelled` flag set on cleanup.
  // This avoids all stale-closure bugs that recursive useCallback has.
  useEffect(() => {
    if (!permission?.granted || !cameraReady || scanPhase !== "scanning") return;

    let cancelled = false;
    let localFrame = 0;
    let ocrHintShown = false;

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const loop = async () => {
      // Small initial delay so the camera exposure can settle
      await delay(600);

      while (!cancelled && scanPhaseRef.current === "scanning") {
        localFrame++;
        setFrameCount(localFrame);

        // Rotate through useful hints
        if (localFrame === 1) {
          updateHint("Scanning — hold document steady");
        } else if (localFrame % 10 === 0) {
          updateHint(`${localFrame} frames — align MRZ zone in frame`);
        } else if (localFrame === 5 && !ocrHintShown) {
          ocrHintShown = true;
          updateHint("On-device OCR active — hold document steady");
        }

        // Capture full frame
        const photo = await capture({ quality: 0.85, base64: false, skipProcessing: false });

        if (photo) {
          // Update live thumbnail — subtle flash only (not blinding white every frame)
          setLastCaptureUri(photo.uri);
          Animated.sequence([
            Animated.timing(captureFlashAnim, { toValue: 0.25, duration: 80, useNativeDriver: true }),
            Animated.timing(captureFlashAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
          ]).start();

          updateHint("Analysing…");

          // ── Preprocess: crop to the MRZ zone band then resize ─────────────
          // The scan overlay places the MRZ zone at 44 %–74 % of screen height.
          // We map those fractions onto the captured image and add a 10 %
          // margin so slightly off-centre cards are still captured.
          // Belgian eID MRZ lives in the bottom quarter of the card, so
          // targeting 40 %–82 % of the image catches it reliably.
          let ocrUri: string | null = null;
          try {
            const imgW = photo.width ?? 1000;
            const imgH = photo.height ?? 1333;
            const cropTopFrac = 0.38;   // 38 % from top — just above the zone
            const cropBotFrac = 0.84;   // 84 % from top — below the MRZ strip
            const cropTop = Math.floor(imgH * cropTopFrac);
            const cropH  = Math.floor(imgH * (cropBotFrac - cropTopFrac));
            const targetW = Math.min(imgW, 1400); // wide enough for all 44-char lines
            const manipulated = await ImageManipulator.manipulateAsync(
              photo.uri,
              [
                { crop: { originX: 0, originY: cropTop, width: imgW, height: cropH } },
                { resize: { width: targetW } },
              ],
              { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
            );
            ocrUri = manipulated.uri;
          } catch {
            ocrUri = photo.uri;
          }

          const ocrText = ocrUri ? await performLocalOCR(ocrUri) : null;
          console.log(`[MRZ] frame ${localFrame} ocrText:`, JSON.stringify(ocrText));

          if (ocrText) {
            const lines = extractMRZFromText(ocrText);
            console.log(`[MRZ] frame ${localFrame} lines:`, JSON.stringify(lines));
            if (lines) {
              const parsed = parseMRZ(lines);
              console.log(`[MRZ] frame ${localFrame} parsed:`, parsed ? `${parsed.format} valid=${parsed.valid} errors=${JSON.stringify(parsed.errors)}` : "null");
              if (parsed) {
                consecutiveHitsRef.current++;
                console.log(`[MRZ] hit ${consecutiveHitsRef.current}/2 — ${parsed.format} valid=${parsed.valid}`);
                if (consecutiveHitsRef.current >= 2) {
                  console.log(`[MRZ] confirmed — navigating to result`);
                  showResultSheet(parsed, photo.uri);
                  return; // exit loop
                }
                // First hit — wait one more frame to confirm
                updateHint("MRZ detected — hold still…");
                await delay(600); // short focused re-capture
              } else {
                consecutiveHitsRef.current = 0;
                updateHint("MRZ pattern found — hold steadier");
              }
            } else {
              consecutiveHitsRef.current = 0;
              const preview = ocrText.replace(/\n/g, " ").substring(0, 60);
              console.log(`[MRZ] frame ${localFrame} no MRZ pattern in: "${preview}"`);
              updateHint("Text seen — align MRZ strip in the frame");
            }
          } else {
            consecutiveHitsRef.current = 0;
            updateHint("No text — point at MRZ zone at bottom of card");
          }
        }

        // Pause between frames: 1 400 ms lets the camera re-focus and the
        // sensor exposure stabilise before the next capture. This is the main
        // guard against capturing before the document is fully in frame.
        await delay(1400);
      }
    };

    loop();
    return () => { cancelled = true; };
  }, [permission?.granted, cameraReady, scanPhase, capture, updateHint, showResultSheet]);

  // ── Brightness check (runs alongside the scan loop, uses same mutex) ────────
  useEffect(() => {
    if (!permission?.granted || !cameraReady) return;

    const check = async () => {
      const photo = await capture({ quality: 0.05, base64: true, skipProcessing: true });
      if (!photo) return;
      const b64Length = photo.base64?.length ?? 0;
      const isDark = b64Length > 0 && b64Length < DARK_THRESHOLD;
      setLightStatus(isDark ? "dark" : "ok");
      setTorchMode((prev) => {
        if (prev === "manual") return prev;
        if (isDark && prev === "off") {
          setTimeout(() => updateHint("Low light — torch enabled"), 50);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return "auto";
        }
        if (!isDark && prev === "auto") {
          setTimeout(() => updateHint("Light OK — torch off"), 50);
          return "off";
        }
        return prev;
      });
    };

    // First check at 800 ms so torch fires immediately if the scene is dark,
    // then every 8 s to track changing light conditions.
    const t = setTimeout(() => check(), 800);
    const iv = setInterval(() => check(), 8000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [permission?.granted, cameraReady, capture, updateHint]);

  // ── Restore scanning state when screen regains focus ─────────────────────
  // After router.push("/result") + router.back(), scanPhase is still "found"
  // and the scan loop never restarts. useFocusEffect fires whenever this
  // screen becomes active again — we reset everything to "scanning" so the
  // loop useEffect re-runs and a new scan can begin.
  useFocusEffect(
    useCallback(() => {
      if (scanPhaseRef.current === "found") {
        captureActiveRef.current = false; // release any stale capture mutex
        consecutiveHitsRef.current = 0;  // reset confirmation counter
        setFrameCount(0);
        scanPhaseRef.current = "scanning";
        setScanPhase("scanning");
        updateHint("Hold document in frame — scanning");
      }
    }, [updateHint])
  );

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    if (scanPhaseRef.current === "scanning") {
      scanPhaseRef.current = "paused";
      setScanPhase("paused");
      updateHint("Paused — tap ▶ to resume");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (scanPhaseRef.current === "paused" || scanPhaseRef.current === "found") {
      // Resume from paused — also handles stale "found" state as a safety net
      captureActiveRef.current = false;
      setFrameCount(0);
      scanPhaseRef.current = "scanning";
      setScanPhase("scanning");
      updateHint("Scanning resumed");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [updateHint]);

  const handleScanAgain = useCallback(() => {
    setShowResult(false);
    setResult(null);
    setFrameCount(0);
    scanPhaseRef.current = "scanning";
    setScanPhase("scanning");
    updateHint("Hold document in frame — scanning");
  }, [updateHint]);

  const toggleTorch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTorchMode((prev) => {
      if (prev === "off") return "manual";
      if (prev === "manual") return "off";
      return "off"; // override auto → off
    });
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
    showResultSheet(parsed);
  }, [manualInput, showResultSheet]);

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
      <View style={[nativeStyles.centered, { backgroundColor: "#000" }]}>
        <ActivityIndicator color="#00FF88" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={[
          nativeStyles.permissionContainer,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={nativeStyles.permissionIcon}>
          <Feather name="camera" size={48} color="#00FF88" />
        </View>
        <Text style={nativeStyles.permissionTitle}>Camera Access Required</Text>
        <Text style={nativeStyles.permissionSubtitle}>
          The camera is used to auto-scan MRZ zones on ID documents and passports.
        </Text>
        {!permission.canAskAgain ? (
          <Pressable
            style={nativeStyles.permissionBtn}
            onPress={() => {
              const Linking = require("expo-linking");
              Linking.openSettings().catch(() => {});
            }}
          >
            <Text style={nativeStyles.permissionBtnText}>Open Settings</Text>
          </Pressable>
        ) : (
          <Pressable style={nativeStyles.permissionBtn} onPress={requestPermission}>
            <Text style={nativeStyles.permissionBtnText}>Grant Camera Access</Text>
          </Pressable>
        )}
        <Pressable
          style={[nativeStyles.manualBtn, { marginTop: 12 }]}
          onPress={() => setShowManualEntry(true)}
        >
          <Feather name="edit-2" size={16} color="#8B949E" />
          <Text style={nativeStyles.manualBtnText}>Test with manual input</Text>
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
  const isFound = scanPhase === "found";

  return (
    <View style={nativeStyles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
        autofocus="on"
        onCameraReady={() => {
          setCameraReady(true);
          updateHint("Hold document in frame — scanning");
        }}
      />

      <ScanOverlay scanning={isScanning} detected={isFound} />

      {/* Top bar */}
      <View
        style={[
          nativeStyles.topBar,
          {
            paddingTop: isLandscape ? 6 : insets.top + 8,
            paddingLeft: insets.left + (isLandscape ? 16 : 20),
            paddingRight: insets.right + (isLandscape ? 16 : 20),
          },
        ]}
      >
        <View>
          <Text style={nativeStyles.appTitle}>MRZ Scanner</Text>
          {frameCount > 0 && (
            <View style={nativeStyles.frameCountRow}>
              {isScanning && <ActivityIndicator size="small" color="#00FF88" style={{ marginRight: 4 }} />}
              <Text style={nativeStyles.frameCount}>
                {isScanning ? `Frame ${frameCount}` : isFound ? "MRZ found" : `Paused · ${frameCount} frames`}
              </Text>
            </View>
          )}
        </View>

        <View style={nativeStyles.torchGroup}>
          {lightStatus !== "unknown" && (
            <View
              style={[
                nativeStyles.lightBadge,
                { backgroundColor: lightStatus === "dark" ? "rgba(240,136,62,0.18)" : "rgba(0,255,136,0.12)" },
              ]}
            >
              <Feather
                name={lightStatus === "dark" ? "moon" : "sun"}
                size={11}
                color={lightStatus === "dark" ? "#F0883E" : "#00FF88"}
              />
              <Text
                style={[
                  nativeStyles.lightBadgeText,
                  { color: lightStatus === "dark" ? "#F0883E" : "#00FF88" },
                ]}
              >
                {lightStatus === "dark" ? "Low light" : "Good light"}
              </Text>
            </View>
          )}
          <Pressable
            testID="torch-button"
            onPress={toggleTorch}
            style={({ pressed }) => [
              nativeStyles.iconBtn,
              {
                backgroundColor: torchOn ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.12)",
                borderColor:
                  torchMode === "auto" ? "#F0883E" : torchMode === "manual" ? "#00FF88" : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather
              name={torchOn ? "zap" : "zap-off"}
              size={20}
              color={torchMode === "auto" ? "#F0883E" : torchOn ? "#00FF88" : "#FFFFFF"}
            />
            {torchMode === "auto" && (
              <View style={nativeStyles.autoBadge}>
                <Text style={nativeStyles.autoBadgeText}>A</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* Hint pill — sits above the controls; in landscape it sits at the very bottom */}
      <Animated.View
        style={[
          nativeStyles.hintContainer,
          {
            bottom: isLandscape ? insets.bottom + 6 : insets.bottom + 130,
            opacity: hintAnim,
          },
        ]}
        pointerEvents="none"
      >
        <View style={nativeStyles.hintBubble}>
          <Text style={nativeStyles.hintText}>{hint}</Text>
        </View>
      </Animated.View>

      {/* Live capture thumbnail — tap to expand */}
      {lastCaptureUri && !showResult && (
        <Pressable
          onPress={() => setPreviewExpanded(true)}
          style={[
            nativeStyles.thumbnailContainer,
            isLandscape
              ? { top: insets.top + 8, left: insets.left + 8 }
              : { bottom: insets.bottom + 100, left: 16 },
          ]}
        >
          <Animated.View
            style={[
              nativeStyles.thumbnailFlash,
              { opacity: captureFlashAnim },
            ]}
          />
          <Image
            source={{ uri: lastCaptureUri }}
            style={nativeStyles.thumbnailImage}
            resizeMode="cover"
          />
          <View style={nativeStyles.thumbnailLabel}>
            <Feather name="eye" size={9} color="#FFFFFF" />
            <Text style={nativeStyles.thumbnailLabelText}>Last frame</Text>
          </View>
        </Pressable>
      )}

      {/* Expanded frame viewer */}
      <Modal
        visible={previewExpanded}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewExpanded(false)}
      >
        <Pressable
          style={nativeStyles.expandedBackdrop}
          onPress={() => setPreviewExpanded(false)}
        >
          {lastCaptureUri && (
            <View style={nativeStyles.expandedContainer}>
              <Image
                source={{ uri: lastCaptureUri }}
                style={nativeStyles.expandedImage}
                resizeMode="contain"
              />
              <View style={nativeStyles.expandedHint}>
                <Feather name="info" size={12} color="#8B949E" />
                <Text style={nativeStyles.expandedHintText}>
                  Make sure the MRZ rows are sharp and horizontal. Tap anywhere to close.
                </Text>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>

      {/* Bottom controls */}
      <View style={[nativeStyles.bottomControls, { paddingBottom: insets.bottom + 20 }]}>
        {/* Manual entry */}
        <Pressable
          testID="manual-entry-button"
          onPress={() => setShowManualEntry(true)}
          style={({ pressed }) => [nativeStyles.sideBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="edit-2" size={22} color="#FFFFFF" />
        </Pressable>

        {/* Pause / Resume */}
        <Pressable
          testID="pause-resume-button"
          onPress={togglePause}
          disabled={isFound}
          style={({ pressed }) => [
            nativeStyles.pauseBtn,
            {
              opacity: pressed || isFound ? 0.5 : 1,
              backgroundColor: isScanning ? "rgba(255,255,255,0.18)" : "rgba(0,255,136,0.25)",
              borderColor: isScanning ? "rgba(255,255,255,0.4)" : "#00FF88",
            },
          ]}
        >
          <Feather
            name={isScanning ? "pause" : "play"}
            size={28}
            color={isScanning ? "#FFFFFF" : "#00FF88"}
          />
        </Pressable>

        {/* Spacer */}
        <View style={nativeStyles.sideBtn} />
      </View>

      {/* Manual entry modal */}
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

function ManualEntryModal({
  visible, value, onChangeText, onClose, onParse, onInsertSample,
}: ManualEntryModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          modalStyles.container,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={modalStyles.header}>
          <Text style={modalStyles.title}>Manual MRZ Entry</Text>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Feather name="x" size={22} color="#8B949E" />
          </Pressable>
        </View>
        <Text style={modalStyles.subtitle}>
          Paste MRZ text or load a sample below to test the parser.
        </Text>
        <View style={modalStyles.sampleRow}>
          <Text style={modalStyles.sampleLabel}>Sample:</Text>
          <Pressable
            testID="sample-passport"
            onPress={() => onInsertSample("passport")}
            style={({ pressed }) => [modalStyles.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={modalStyles.sampleBtnText}>Passport (TD3)</Text>
          </Pressable>
          <Pressable
            testID="sample-id"
            onPress={() => onInsertSample("id")}
            style={({ pressed }) => [modalStyles.sampleBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={modalStyles.sampleBtnText}>ID Card (TD1)</Text>
          </Pressable>
        </View>
        <TextInput
          testID="mrz-text-input"
          style={modalStyles.input}
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
        <Text style={modalStyles.formatHint}>
          • Passport (TD3): 2 lines × 44 chars{"\n"}
          • ID Card (TD1): 3 lines × 30 chars{"\n"}
          • Older docs (TD2): 2 lines × 36 chars{"\n"}
          Use uppercase + digits + {'<'} as filler
        </Text>
        <Pressable
          testID="parse-button"
          onPress={onParse}
          style={({ pressed }) => [modalStyles.parseBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Feather name="check" size={18} color="#0D1117" />
          <Text style={modalStyles.parseBtnText}>Parse MRZ</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D1117",
    paddingHorizontal: 20,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" as const },
  subtitle: { color: "#8B949E", fontSize: 13, lineHeight: 20 },
  sampleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sampleLabel: { color: "#8B949E", fontSize: 13 },
  sampleBtn: {
    backgroundColor: "#21262D",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sampleBtnText: { color: "#00FF88", fontSize: 13, fontWeight: "500" as const },
  input: {
    backgroundColor: "#161B22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363D",
    color: "#FFFFFF",
    fontSize: 11,
    padding: 14,
    minHeight: 120,
    letterSpacing: 0.3,
    textAlignVertical: "top",
  },
  formatHint: { color: "#8B949E", fontSize: 12, lineHeight: 20 },
  parseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#00FF88",
    borderRadius: 14,
    paddingVertical: 15,
  },
  parseBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
});

// ─────────────────────────────────────────────────────────────────────────────
// Root: pick the right UI based on platform
// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerScreen() {
  if (Platform.OS === "web") {
    return <WebParserUI />;
  }
  return <NativeScannerUI />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — native scanner
// ─────────────────────────────────────────────────────────────────────────────
const nativeStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Top bar
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  appTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" as const },
  frameCountRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  frameCount: { color: "#8B949E", fontSize: 12 },

  // Torch group
  torchGroup: { alignItems: "flex-end", gap: 6 },
  lightBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  lightBadgeText: { fontSize: 11, fontWeight: "600" as const },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  autoBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F0883E",
    alignItems: "center",
    justifyContent: "center",
  },
  autoBadgeText: { color: "#0D1117", fontSize: 8, fontWeight: "700" as const },

  // Hint
  hintContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hintBubble: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  hintText: { color: "#FFFFFF", fontSize: 13, fontWeight: "500" as const },

  // Bottom controls
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 40,
  },
  sideBtn: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pauseBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  // Live capture thumbnail
  thumbnailContainer: {
    position: "absolute",
    width: 108,
    height: 76,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(0,255,136,0.5)",
  },
  thumbnailFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFFFFF",
    zIndex: 2,
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  thumbnailLabel: {
    position: "absolute",
    bottom: 4,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 2,
  },
  thumbnailLabelText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 0.3,
  },

  // Expanded frame viewer
  expandedBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  expandedContainer: {
    width: "100%",
    gap: 16,
  },
  expandedImage: {
    width: "100%",
    height: 260,
    borderRadius: 12,
  },
  expandedHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 12,
  },
  expandedHintText: {
    color: "#8B949E",
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },

  backdrop: { flex: 1 },
  resultSheetWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },

  // Permission
  permissionContainer: {
    flex: 1,
    backgroundColor: "#0D1117",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  permissionIcon: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: "rgba(0,255,136,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  permissionTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" as const, textAlign: "center" },
  permissionSubtitle: { color: "#8B949E", fontSize: 15, textAlign: "center", lineHeight: 22 },
  permissionBtn: {
    backgroundColor: "#00FF88",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  permissionBtnText: { color: "#0D1117", fontSize: 16, fontWeight: "600" as const },
  manualBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10 },
  manualBtnText: { color: "#8B949E", fontSize: 14 },
});
