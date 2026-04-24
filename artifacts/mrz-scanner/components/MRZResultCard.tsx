import React from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { ParsedMRZ } from "@/lib/mrz";

interface Props {
  result: ParsedMRZ;
  onClose: () => void;
  onScanAgain: () => void;
}

interface FieldRowProps {
  label: string;
  value: string;
  valid?: boolean;
  mono?: boolean;
}

function FieldRow({ label, value, valid, mono }: FieldRowProps) {
  const colors = useColors();
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.fieldValueRow}>
        <Text
          style={[
            styles.fieldValue,
            { color: colors.foreground, fontFamily: mono ? "monospace" : undefined },
          ]}
        >
          {value || "—"}
        </Text>
        {valid !== undefined && (
          <Feather
            name={valid ? "check-circle" : "alert-circle"}
            size={14}
            color={valid ? colors.success : colors.warning}
            style={styles.validIcon}
          />
        )}
      </View>
    </View>
  );
}

export function MRZResultCard({ result, onClose, onScanAgain }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const fullName = [result.givenNames, result.surname].filter(Boolean).join(" ") || "—";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          paddingBottom: insets.bottom + 16,
          ...(Platform.OS === "web" ? { paddingBottom: insets.bottom + 34 + 16 } : {}),
        },
      ]}
    >
      {/* Handle */}
      <View style={[styles.handle, { backgroundColor: colors.border }]} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: result.valid ? `${colors.success}22` : `${colors.warning}22` },
            ]}
          >
            <Feather
              name={result.valid ? "shield" : "alert-triangle"}
              size={14}
              color={result.valid ? colors.success : colors.warning}
            />
            <Text
              style={[
                styles.statusText,
                { color: result.valid ? colors.success : colors.warning },
              ]}
            >
              {result.valid ? "Valid MRZ" : "Check Errors"}
            </Text>
          </View>
          <Text style={[styles.formatBadge, { color: colors.mutedForeground }]}>
            {result.format}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Name */}
        <View style={[styles.nameSection, { borderBottomColor: colors.border }]}>
          <Text style={[styles.nameLabel, { color: colors.mutedForeground }]}>Name</Text>
          <Text style={[styles.nameValue, { color: colors.foreground }]}>{fullName}</Text>
        </View>

        {/* Core fields */}
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <FieldRow
            label="Document Number"
            value={result.documentNumber.value}
            valid={result.documentNumber.valid}
            mono
          />
          <FieldRow label="Document Type" value={result.documentType} />
          <FieldRow label="Issuing Country" value={result.issuingCountry} />
          <FieldRow label="Nationality" value={result.nationality} />
        </View>

        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <FieldRow
            label="Date of Birth"
            value={result.dateOfBirth.value}
            valid={result.dateOfBirth.valid}
          />
          <FieldRow label="Sex" value={result.sex} />
          <FieldRow
            label="Expiry Date"
            value={result.expiryDate.value}
            valid={result.expiryDate.valid}
          />
        </View>

        {result.optionalData ? (
          <View style={[styles.section, { borderBottomColor: colors.border }]}>
            <FieldRow label="Optional Data" value={result.optionalData} mono />
            {result.optionalData2 ? (
              <FieldRow label="Optional Data 2" value={result.optionalData2} mono />
            ) : null}
          </View>
        ) : null}

        {/* Errors */}
        {result.errors.length > 0 && (
          <View
            style={[
              styles.errorsSection,
              { backgroundColor: `${colors.warning}15`, borderColor: `${colors.warning}40` },
            ]}
          >
            <View style={styles.errorsHeader}>
              <Feather name="alert-triangle" size={14} color={colors.warning} />
              <Text style={[styles.errorsTitle, { color: colors.warning }]}>
                Validation Warnings
              </Text>
            </View>
            {result.errors.map((e, i) => (
              <Text key={i} style={[styles.errorItem, { color: colors.mutedForeground }]}>
                • {e}
              </Text>
            ))}
          </View>
        )}

        {/* Raw MRZ lines */}
        <View
          style={[
            styles.rawSection,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.rawLabel, { color: colors.mutedForeground }]}>Raw MRZ</Text>
          {result.rawLines.map((line, i) => (
            <Text
              key={i}
              style={[styles.rawLine, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>

      {/* Scan Again */}
      <Pressable
        onPress={onScanAgain}
        style={({ pressed }) => [
          styles.scanAgainBtn,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Feather name="camera" size={18} color={colors.primaryForeground} />
        <Text style={[styles.scanAgainText, { color: colors.primaryForeground }]}>
          Scan Another
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  formatBadge: {
    fontSize: 12,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
    gap: 0,
  },
  nameSection: {
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  nameLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  nameValue: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  section: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: 13,
    flex: 1,
  },
  fieldValueRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1.2,
    justifyContent: "flex-end",
    gap: 6,
  },
  fieldValue: {
    fontSize: 13,
    fontWeight: "500" as const,
    textAlign: "right",
    flexShrink: 1,
  },
  validIcon: {
    marginLeft: 2,
  },
  errorsSection: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  errorsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  errorsTitle: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  errorItem: {
    fontSize: 12,
    lineHeight: 18,
  },
  rawSection: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
    gap: 4,
  },
  rawLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  rawLine: {
    fontSize: 10,
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },
  scanAgainBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 4,
  },
  scanAgainText: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
});
