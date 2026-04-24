import React, { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getLastResult, clearLastResult } from "@/lib/resultStore";
import { MRZField, MRZFormat } from "@/lib/mrz";

// ── ISO 3166-1 alpha-3 → alpha-2 for flag emojis ─────────────────────────────
const A3_TO_A2: Record<string, string> = {
  AFG:"AF",ALB:"AL",DZA:"DZ",AND:"AD",AGO:"AO",ATG:"AG",ARG:"AR",ARM:"AM",
  AUS:"AU",AUT:"AT",AZE:"AZ",BHS:"BS",BHR:"BH",BGD:"BD",BRB:"BB",BLR:"BY",
  BEL:"BE",BLZ:"BZ",BEN:"BJ",BTN:"BT",BOL:"BO",BIH:"BA",BWA:"BW",BRA:"BR",
  BRN:"BN",BGR:"BG",BFA:"BF",BDI:"BI",CPV:"CV",KHM:"KH",CMR:"CM",CAN:"CA",
  CAF:"CF",TCD:"TD",CHL:"CL",CHN:"CN",COL:"CO",COM:"KM",COD:"CD",COG:"CG",
  CRI:"CR",HRV:"HR",CUB:"CU",CYP:"CY",CZE:"CZ",DNK:"DK",DJI:"DJ",DOM:"DO",
  ECU:"EC",EGY:"EG",SLV:"SV",GNQ:"GQ",ERI:"ER",EST:"EE",SWZ:"SZ",ETH:"ET",
  FJI:"FJ",FIN:"FI",FRA:"FR",GAB:"GA",GMB:"GM",GEO:"GE",DEU:"DE",GHA:"GH",
  GRC:"GR",GRD:"GD",GTM:"GT",GIN:"GN",GNB:"GW",GUY:"GY",HTI:"HT",HND:"HN",
  HUN:"HU",ISL:"IS",IND:"IN",IDN:"ID",IRN:"IR",IRQ:"IQ",IRL:"IE",ISR:"IL",
  ITA:"IT",JAM:"JM",JPN:"JP",JOR:"JO",KAZ:"KZ",KEN:"KE",KIR:"KI",PRK:"KP",
  KOR:"KR",KWT:"KW",KGZ:"KG",LAO:"LA",LVA:"LV",LBN:"LB",LSO:"LS",LBR:"LR",
  LBY:"LY",LIE:"LI",LTU:"LT",LUX:"LU",MDG:"MG",MWI:"MW",MYS:"MY",MDV:"MV",
  MLI:"ML",MLT:"MT",MHL:"MH",MRT:"MR",MUS:"MU",MEX:"MX",FSM:"FM",MDA:"MD",
  MCO:"MC",MNG:"MN",MNE:"ME",MAR:"MA",MOZ:"MZ",MMR:"MM",NAM:"NA",NRU:"NR",
  NPL:"NP",NLD:"NL",NZL:"NZ",NIC:"NI",NER:"NE",NGA:"NG",MKD:"MK",NOR:"NO",
  OMN:"OM",PAK:"PK",PLW:"PW",PAN:"PA",PNG:"PG",PRY:"PY",PER:"PE",PHL:"PH",
  POL:"PL",PRT:"PT",QAT:"QA",ROU:"RO",RUS:"RU",RWA:"RW",KNA:"KN",LCA:"LC",
  VCT:"VC",WSM:"WS",SMR:"SM",STP:"ST",SAU:"SA",SEN:"SN",SRB:"RS",SYC:"SC",
  SLE:"SL",SGP:"SG",SVK:"SK",SVN:"SI",SLB:"SB",SOM:"SO",ZAF:"ZA",SSD:"SS",
  ESP:"ES",LKA:"LK",SDN:"SD",SUR:"SR",SWE:"SE",CHE:"CH",SYR:"SY",TWN:"TW",
  TJK:"TJ",TZA:"TZ",THA:"TH",TLS:"TL",TGO:"TG",TON:"TO",TTO:"TT",TUN:"TN",
  TUR:"TR",TKM:"TM",TUV:"TV",UGA:"UG",UKR:"UA",ARE:"AE",GBR:"GB",USA:"US",
  URY:"UY",UZB:"UZ",VUT:"VU",VEN:"VE",VNM:"VN",YEM:"YE",ZMB:"ZM",ZWE:"ZW",
};

function countryFlag(alpha3: string): string {
  const a2 = A3_TO_A2[alpha3.toUpperCase()];
  if (!a2 || a2.length !== 2) return "🌐";
  const codePoints = [...a2].map((c) => 0x1f1e0 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

function formatLabel(format: MRZFormat): string {
  if (format === "TD3") return "Passport (TD3)";
  if (format === "TD1") return "ID Card (TD1)";
  if (format === "TD2") return "ID Card (TD2)";
  return "Unknown";
}

function initials(surname: string, givenNames: string): string {
  const parts = [givenNames, surname].filter(Boolean);
  return parts
    .map((s) => s.trim()[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <Text style={[styles.sectionHeader, { color }]}>{title}</Text>
  );
}

function Row({
  label,
  value,
  valid,
  mono,
  colors,
}: {
  label: string;
  value: string;
  valid?: boolean;
  mono?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.rowRight}>
        <Text
          style={[
            styles.rowValue,
            { color: colors.foreground },
            mono && { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
          ]}
          numberOfLines={1}
        >
          {value || "—"}
        </Text>
        {valid === true && (
          <Feather name="check-circle" size={13} color={colors.success} />
        )}
        {valid === false && (
          <Feather name="alert-circle" size={13} color={colors.warning} />
        )}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ResultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const stored = getLastResult();

  // Animation refs
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 80,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 10,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleScanAgain = () => {
    clearLastResult();
    router.back();
  };

  if (!stored) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          No result available
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backFallback}>
          <Text style={{ color: colors.primary }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const { parsed, thumbnailUri, scannedAt } = stored;
  const flag = countryFlag(parsed.nationality || parsed.issuingCountry);
  const fullName =
    [parsed.givenNames, parsed.surname].filter(Boolean).join(" ").trim() || "—";
  const avatarText = initials(parsed.surname, parsed.givenNames);
  const isValid = parsed.valid;
  const statusColor = isValid ? colors.success : colors.warning;
  const statusIcon = isValid ? "shield" : "alert-triangle";
  const statusLabel = isValid ? "Verified" : "Check Errors";

  const timeStr = scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = scannedAt.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={handleScanAgain}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Scan Result</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.hero,
            { opacity: opacityAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Status icon */}
          <Animated.View
            style={[
              styles.iconCircle,
              {
                backgroundColor: `${statusColor}1A`,
                borderColor: `${statusColor}40`,
                transform: [{ scale: scaleAnim }],
              },
            ]}
          >
            <Feather name={statusIcon} size={40} color={statusColor} />
          </Animated.View>

          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={[styles.formatLabel, { color: colors.mutedForeground }]}>
            {formatLabel(parsed.format)}
          </Text>
          <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
            {dateStr} · {timeStr}
          </Text>
        </Animated.View>

        {/* ── Name card ─────────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.nameCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: opacityAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Avatar */}
          <View style={[styles.avatar, { backgroundColor: `${statusColor}22` }]}>
            <Text style={[styles.avatarText, { color: statusColor }]}>{avatarText || "?"}</Text>
          </View>

          <Text style={[styles.fullName, { color: colors.foreground }]} numberOfLines={2}>
            {fullName}
          </Text>

          <View style={styles.nationalityRow}>
            <Text style={styles.flagText}>{flag}</Text>
            <Text style={[styles.nationalityText, { color: colors.mutedForeground }]}>
              {parsed.nationality || parsed.issuingCountry || "—"}
            </Text>
          </View>
        </Animated.View>

        {/* ── Document details ──────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: opacityAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <SectionHeader title="DOCUMENT" color={colors.mutedForeground} />
          <Row label="Type" value={parsed.documentType} colors={colors} />
          <Row
            label="Number"
            value={parsed.documentNumber.value}
            valid={parsed.documentNumber.valid}
            mono
            colors={colors}
          />
          <Row label="Issuing Country" value={parsed.issuingCountry} colors={colors} />
          <Row label="Nationality" value={parsed.nationality} colors={colors} />
        </Animated.View>

        {/* ── Personal information ──────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: opacityAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <SectionHeader title="PERSONAL" color={colors.mutedForeground} />
          <Row
            label="Date of Birth"
            value={parsed.dateOfBirth.value}
            valid={parsed.dateOfBirth.valid}
            colors={colors}
          />
          <Row label="Sex" value={parsed.sex} colors={colors} />
          <Row
            label="Expiry Date"
            value={parsed.expiryDate.value}
            valid={parsed.expiryDate.valid}
            colors={colors}
          />
          {parsed.optionalData ? (
            <Row label="Optional" value={parsed.optionalData} mono colors={colors} />
          ) : null}
        </Animated.View>

        {/* ── Scan thumbnail ────────────────────────────────────────────────── */}
        {thumbnailUri ? (
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: opacityAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <SectionHeader title="CAPTURED FRAME" color={colors.mutedForeground} />
            <Image
              source={{ uri: thumbnailUri }}
              style={[styles.thumbnail, { borderColor: colors.border }]}
              resizeMode="cover"
            />
          </Animated.View>
        ) : null}

        {/* ── Validation errors ─────────────────────────────────────────────── */}
        {parsed.errors.length > 0 && (
          <Animated.View
            style={[
              styles.card,
              styles.warningCard,
              {
                backgroundColor: `${colors.warning}12`,
                borderColor: `${colors.warning}35`,
                opacity: opacityAnim,
              },
            ]}
          >
            <View style={styles.warningHeader}>
              <Feather name="alert-triangle" size={14} color={colors.warning} />
              <Text style={[styles.warningTitle, { color: colors.warning }]}>
                Validation Warnings
              </Text>
            </View>
            {parsed.errors.map((e, i) => (
              <Text key={i} style={[styles.warningItem, { color: colors.mutedForeground }]}>
                · {e}
              </Text>
            ))}
          </Animated.View>
        )}

        {/* ── Raw MRZ ───────────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.card,
            styles.rawCard,
            {
              backgroundColor: colors.muted,
              borderColor: colors.border,
              opacity: opacityAnim,
            },
          ]}
        >
          <SectionHeader title="RAW MRZ" color={colors.mutedForeground} />
          {parsed.rawLines.map((line, i) => (
            <Text
              key={i}
              style={[
                styles.rawLine,
                { color: colors.foreground },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {line}
            </Text>
          ))}
        </Animated.View>
      </ScrollView>

      {/* ── Sticky footer ─────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={handleScanAgain}
          style={({ pressed }) => [
            styles.scanBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="camera" size={18} color={colors.primaryForeground} />
          <Text style={[styles.scanBtnText, { color: colors.primaryForeground }]}>
            Scan Another
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 16 },
  backFallback: { padding: 12 },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, width: 32, alignItems: "flex-start" },
  topBarTitle: { fontSize: 16, fontWeight: "600" as const },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 24, gap: 12 },

  // Hero
  hero: { alignItems: "center", gap: 8, paddingBottom: 8 },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statusLabel: { fontSize: 20, fontWeight: "700" as const, letterSpacing: 0.3 },
  formatLabel: { fontSize: 13, fontWeight: "500" as const },
  timestamp: { fontSize: 12 },

  // Name card
  nameCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarText: { fontSize: 24, fontWeight: "700" as const, letterSpacing: 1 },
  fullName: { fontSize: 22, fontWeight: "700" as const, textAlign: "center", letterSpacing: 0.2 },
  nationalityRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flagText: { fontSize: 22 },
  nationalityText: { fontSize: 14, fontWeight: "500" as const },

  // Data cards
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 0,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
  },
  rowLabel: { fontSize: 14, flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1.2, justifyContent: "flex-end" },
  rowValue: { fontSize: 14, fontWeight: "500" as const, textAlign: "right", flexShrink: 1 },

  // Thumbnail
  thumbnail: {
    width: "100%",
    height: 140,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },

  // Warning
  warningCard: {},
  warningHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  warningTitle: { fontSize: 13, fontWeight: "600" as const },
  warningItem: { fontSize: 13, lineHeight: 20, paddingBottom: 2 },

  // Raw MRZ
  rawCard: {},
  rawLine: {
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    letterSpacing: 0.8,
    paddingBottom: 6,
  },

  // Footer
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  scanBtnText: { fontSize: 16, fontWeight: "600" as const },
});
