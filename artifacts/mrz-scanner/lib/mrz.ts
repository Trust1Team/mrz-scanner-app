/**
 * MRZ (Machine Readable Zone) Parser
 *
 * Supports:
 * - TD1: 3 lines × 30 chars (ID cards)
 * - TD2: 2 lines × 36 chars (older passports/ID)
 * - TD3: 2 lines × 44 chars (passports, travel docs)
 *
 * Handles common OCR errors and validates checksums per ICAO 9303.
 */

export type MRZFormat = "TD1" | "TD2" | "TD3" | "UNKNOWN";

export interface MRZField {
  raw: string;
  value: string;
  checkDigit?: string;
  valid?: boolean;
}

export interface ParsedMRZ {
  format: MRZFormat;
  valid: boolean;
  documentType: string;
  issuingCountry: string;
  surname: string;
  givenNames: string;
  documentNumber: MRZField;
  nationality: string;
  dateOfBirth: MRZField;
  sex: string;
  expiryDate: MRZField;
  optionalData: string;
  optionalData2?: string;
  compositeCheckDigit?: MRZField;
  rawLines: string[];
  errors: string[];
}

const MRZ_CHAR_VALUES: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
  "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 18, J: 19, K: 20, L: 21, M: 22, N: 23, O: 24, P: 25,
  Q: 26, R: 27, S: 28, T: 29, U: 30, V: 31, W: 32, X: 33,
  Y: 34, Z: 35, "<": 0,
};

const MRZ_WEIGHTS = [7, 3, 1];

/**
 * OCR error correction: correct common mis-reads in MRZ fields
 * Different rules apply to numeric-only vs alphanumeric fields.
 */
function correctOCR(input: string, mode: "alpha" | "numeric" | "alphanumeric"): string {
  let s = input.toUpperCase().trim();

  if (mode === "numeric") {
    // In numeric-only fields: letters commonly misread as digits
    s = s
      .replace(/O/g, "0")
      .replace(/I/g, "1")
      .replace(/L/g, "1")
      .replace(/B/g, "8")
      .replace(/G/g, "6")
      .replace(/S/g, "5")
      .replace(/Z/g, "2")
      .replace(/Q/g, "0")
      .replace(/D/g, "0")
      .replace(/U/g, "0");
  } else if (mode === "alpha") {
    // In alpha fields: digits commonly misread as letters
    s = s
      .replace(/0/g, "O")
      .replace(/1/g, "I")
      .replace(/8/g, "B")
      .replace(/5/g, "S")
      .replace(/2/g, "Z");
  }
  // alphanumeric: minimal correction — only very confident substitutions
  else {
    s = s
      .replace(/\|/g, "1")
      .replace(/\(/g, "C")
      .replace(/\)/g, "C");
  }

  return s;
}

/**
 * Compute MRZ check digit per ICAO 9303 standard.
 */
export function computeCheckDigit(input: string): string {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i].toUpperCase();
    const val = MRZ_CHAR_VALUES[ch] ?? 0;
    sum += val * MRZ_WEIGHTS[i % 3];
  }
  return String(sum % 10);
}

function validateField(raw: string, checkChar: string): { valid: boolean; corrected: string } {
  const expected = computeCheckDigit(raw);
  if (expected === checkChar) return { valid: true, corrected: raw };

  // Try OCR-corrected version
  const corrected = correctOCR(raw, "alphanumeric");
  const correctedCheck = computeCheckDigit(corrected);
  if (correctedCheck === checkChar) return { valid: true, corrected };

  return { valid: false, corrected: raw };
}

/**
 * Parse date from MRZ format YYMMDD to readable string.
 * Handles century ambiguity for DOB vs expiry.
 */
function parseMRZDate(yymmdd: string, field: "dob" | "expiry"): string {
  if (yymmdd.length !== 6) return yymmdd;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);

  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;

  let yyyy: number;
  if (field === "dob") {
    // DOB: if yy > current year's last 2 digits, it's previous century
    yyyy = yy > (currentYear % 100) ? currentCentury - 100 + yy : currentCentury + yy;
  } else {
    // Expiry: if yy < current year's last 2 digits by more than 50, it's next century
    const currentYY = currentYear % 100;
    yyyy = yy < currentYY - 50 ? currentCentury + 100 + yy : currentCentury + yy;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = months[parseInt(mm, 10) - 1] ?? mm;
  return `${dd} ${monthName} ${yyyy}`;
}

function parseName(nameField: string): { surname: string; givenNames: string } {
  const cleaned = nameField.replace(/</g, " ").trim();
  const parts = nameField.split("<<");
  if (parts.length >= 2) {
    const surname = parts[0].replace(/</g, " ").trim();
    const givenNames = parts.slice(1).join(" ").replace(/</g, " ").replace(/\s+/g, " ").trim();
    return { surname, givenNames };
  }
  return { surname: cleaned, givenNames: "" };
}

/**
 * Normalize a raw MRZ line: strip whitespace, handle common OCR line artifacts
 */
function normalizeLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/[—–]/g, "<")  // dash variants → filler
    .replace(/[`'´]/g, "<")
    .replace(/\|/g, "1")
    .replace(/[.,]/g, "<")
    .replace(/\]/g, "<")     // ] misread as filler
    .substring(0, 60);       // safety cap (increased from 50)
}

/**
 * Detect MRZ format from lines.
 */
export function detectFormat(lines: string[]): MRZFormat {
  if (lines.length === 3 && lines[0].length === 30) return "TD1";
  if (lines.length === 2 && lines[0].length === 36) return "TD2";
  if (lines.length === 2 && lines[0].length === 44) return "TD3";
  return "UNKNOWN";
}

/**
 * Parse TD3 (passport) MRZ — 2 lines × 44 chars
 */
function parseTD3(line1: string, line2: string): ParsedMRZ {
  const errors: string[] = [];

  const documentType = line1.substring(0, 2).replace(/</g, "").trim();
  const issuingCountry = correctOCR(line1.substring(2, 5), "alpha");
  const nameField = line1.substring(5, 44);
  const { surname, givenNames } = parseName(nameField);

  // Line 2
  const docNumRaw = correctOCR(line2.substring(0, 9), "alphanumeric");
  const docCheck = line2[9];
  const { valid: docValid, corrected: docCorrected } = validateField(docNumRaw, docCheck);
  if (!docValid) errors.push("Document number checksum mismatch");

  const nationality = correctOCR(line2.substring(10, 13), "alpha");

  const dobRaw = correctOCR(line2.substring(13, 19), "numeric");
  const dobCheck = line2[19];
  const { valid: dobValid } = validateField(dobRaw, dobCheck);
  if (!dobValid) errors.push("Date of birth checksum mismatch");

  const sex = line2[20] === "M" ? "Male" : line2[20] === "F" ? "Female" : "Unspecified";

  const expiryRaw = correctOCR(line2.substring(21, 27), "numeric");
  const expiryCheck = line2[27];
  const { valid: expiryValid } = validateField(expiryRaw, expiryCheck);
  if (!expiryValid) errors.push("Expiry date checksum mismatch");

  const optionalData = line2.substring(28, 42).replace(/</g, " ").trim();
  const compositeRaw = line2.substring(0, 10) + line2.substring(13, 20) + line2.substring(21, 43);
  const compositeCheck = line2[43];
  const compositeExpected = computeCheckDigit(compositeRaw);
  const compositeValid = compositeCheck === compositeExpected;
  if (!compositeValid) errors.push("Composite checksum mismatch");

  return {
    format: "TD3",
    valid: errors.length === 0,
    documentType,
    issuingCountry,
    surname,
    givenNames,
    documentNumber: { raw: docNumRaw, value: docCorrected, checkDigit: docCheck, valid: docValid },
    nationality,
    dateOfBirth: { raw: dobRaw, value: parseMRZDate(dobRaw, "dob"), checkDigit: dobCheck, valid: dobValid },
    sex,
    expiryDate: { raw: expiryRaw, value: parseMRZDate(expiryRaw, "expiry"), checkDigit: expiryCheck, valid: expiryValid },
    optionalData,
    compositeCheckDigit: { raw: compositeRaw, value: compositeExpected, checkDigit: compositeCheck, valid: compositeValid },
    rawLines: [line1, line2],
    errors,
  };
}

/**
 * Parse TD1 (ID card) MRZ — 3 lines × 30 chars
 */
function parseTD1(line1: string, line2: string, line3: string): ParsedMRZ {
  const errors: string[] = [];

  const documentType = line1.substring(0, 2).replace(/</g, "").trim();
  const issuingCountry = correctOCR(line1.substring(2, 5), "alpha");
  const docNumRaw = correctOCR(line1.substring(5, 14), "alphanumeric");
  const docCheck = line1[14];
  const { valid: docValid, corrected: docCorrected } = validateField(docNumRaw, docCheck);
  if (!docValid) errors.push("Document number checksum mismatch");

  const optionalData1 = line1.substring(15, 30).replace(/</g, " ").trim();

  const dobRaw = correctOCR(line2.substring(0, 6), "numeric");
  const dobCheck = line2[6];
  const { valid: dobValid } = validateField(dobRaw, dobCheck);
  if (!dobValid) errors.push("Date of birth checksum mismatch");

  const sex = line2[7] === "M" ? "Male" : line2[7] === "F" ? "Female" : "Unspecified";

  const expiryRaw = correctOCR(line2.substring(8, 14), "numeric");
  const expiryCheck = line2[14];
  const { valid: expiryValid } = validateField(expiryRaw, expiryCheck);
  if (!expiryValid) errors.push("Expiry date checksum mismatch");

  const nationality = correctOCR(line2.substring(15, 18), "alpha");
  const optionalData2 = line2.substring(18, 29).replace(/</g, " ").trim();

  const compositeRaw =
    line1.substring(5, 30) + line2.substring(0, 7) + line2.substring(8, 15) + line2.substring(18, 29);
  const compositeCheck = line2[29];
  const compositeExpected = computeCheckDigit(compositeRaw);
  const compositeValid = compositeCheck === compositeExpected;
  if (!compositeValid) errors.push("Composite checksum mismatch");

  const { surname, givenNames } = parseName(line3);

  return {
    format: "TD1",
    valid: errors.length === 0,
    documentType,
    issuingCountry,
    surname,
    givenNames,
    documentNumber: { raw: docNumRaw, value: docCorrected, checkDigit: docCheck, valid: docValid },
    nationality,
    dateOfBirth: { raw: dobRaw, value: parseMRZDate(dobRaw, "dob"), checkDigit: dobCheck, valid: dobValid },
    sex,
    expiryDate: { raw: expiryRaw, value: parseMRZDate(expiryRaw, "expiry"), checkDigit: expiryCheck, valid: expiryValid },
    optionalData: optionalData1,
    optionalData2,
    compositeCheckDigit: { raw: compositeRaw, value: compositeExpected, checkDigit: compositeCheck, valid: compositeValid },
    rawLines: [line1, line2, line3],
    errors,
  };
}

/**
 * Parse TD2 MRZ — 2 lines × 36 chars
 */
function parseTD2(line1: string, line2: string): ParsedMRZ {
  const errors: string[] = [];

  const documentType = line1.substring(0, 2).replace(/</g, "").trim();
  const issuingCountry = correctOCR(line1.substring(2, 5), "alpha");
  const nameField = line1.substring(5, 36);
  const { surname, givenNames } = parseName(nameField);

  const docNumRaw = correctOCR(line2.substring(0, 9), "alphanumeric");
  const docCheck = line2[9];
  const { valid: docValid, corrected: docCorrected } = validateField(docNumRaw, docCheck);
  if (!docValid) errors.push("Document number checksum mismatch");

  const nationality = correctOCR(line2.substring(10, 13), "alpha");

  const dobRaw = correctOCR(line2.substring(13, 19), "numeric");
  const dobCheck = line2[19];
  const { valid: dobValid } = validateField(dobRaw, dobCheck);
  if (!dobValid) errors.push("Date of birth checksum mismatch");

  const sex = line2[20] === "M" ? "Male" : line2[20] === "F" ? "Female" : "Unspecified";

  const expiryRaw = correctOCR(line2.substring(21, 27), "numeric");
  const expiryCheck = line2[27];
  const { valid: expiryValid } = validateField(expiryRaw, expiryCheck);
  if (!expiryValid) errors.push("Expiry date checksum mismatch");

  const optionalData = line2.substring(28, 35).replace(/</g, " ").trim();
  const compositeCheck = line2[35];
  const compositeRaw = line2.substring(0, 35);
  const compositeExpected = computeCheckDigit(compositeRaw);
  const compositeValid = compositeCheck === compositeExpected;
  if (!compositeValid) errors.push("Composite checksum mismatch");

  return {
    format: "TD2",
    valid: errors.length === 0,
    documentType,
    issuingCountry,
    surname,
    givenNames,
    documentNumber: { raw: docNumRaw, value: docCorrected, checkDigit: docCheck, valid: docValid },
    nationality,
    dateOfBirth: { raw: dobRaw, value: parseMRZDate(dobRaw, "dob"), checkDigit: dobCheck, valid: dobValid },
    sex,
    expiryDate: { raw: expiryRaw, value: parseMRZDate(expiryRaw, "expiry"), checkDigit: expiryCheck, valid: expiryValid },
    optionalData,
    compositeCheckDigit: { raw: compositeRaw, value: compositeExpected, checkDigit: compositeCheck, valid: compositeValid },
    rawLines: [line1, line2],
    errors,
  };
}

/**
 * Main entry point: parse MRZ lines into structured data.
 * Accepts 2 or 3 lines. Lines will be normalized before parsing.
 * When the format cannot be determined exactly, attempts a best-effort
 * parse by padding/trimming to the nearest standard length.
 */
export function parseMRZ(lines: string[]): ParsedMRZ | null {
  if (!lines || lines.length < 2) return null;

  const normalized = lines.map(normalizeLine);
  const format = detectFormat(normalized);

  try {
    if (format === "TD3" && normalized.length >= 2) {
      return parseTD3(normalized[0], normalized[1]);
    }
    if (format === "TD1" && normalized.length >= 3) {
      return parseTD1(normalized[0], normalized[1], normalized[2]);
    }
    if (format === "TD2" && normalized.length >= 2) {
      return parseTD2(normalized[0], normalized[1]);
    }

    // ── Best-effort for UNKNOWN format ─────────────────────────────────────
    // OCR lines are close but not exact — pad/trim to nearest standard and try.
    if (format === "UNKNOWN") {
      const l0 = normalized[0];
      const l1 = normalized[1];

      // 3-line input → try TD1 (3 × 30)
      if (normalized.length >= 3) {
        try {
          return parseTD1(padMRZ(normalized[0], 30), padMRZ(normalized[1], 30), padMRZ(normalized[2], 30));
        } catch { /* fall through */ }
      }

      // 2-line input, longer lines → try TD3 (2 × 44)
      if (l0.length >= 38 && l1.length >= 38) {
        try { return parseTD3(padMRZ(l0, 44), padMRZ(l1, 44)); } catch { /* fall through */ }
      }

      // 2-line input, medium lines → try TD2 (2 × 36)
      if (l0.length >= 28 && l1.length >= 28) {
        try { return parseTD2(padMRZ(l0, 36), padMRZ(l1, 36)); } catch { /* fall through */ }
      }

      // Last resort: 2-line shorter → try TD3 anyway (most common document)
      if (normalized.length >= 2) {
        try { return parseTD3(padMRZ(l0, 44), padMRZ(l1, 44)); } catch { /* fall through */ }
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Pad an MRZ line to exactly `len` characters using `<` filler.
 * If the line is longer than `len`, it is truncated.
 * GPT sometimes omits trailing filler chars, so padding recovers them.
 */
function padMRZ(line: string, len: number): string {
  if (line.length >= len) return line.substring(0, len);
  return line + "<".repeat(len - line.length);
}

/**
 * Extract MRZ lines from OCR text. Handles common OCR output formats.
 * Tries to find valid MRZ lines within a block of text.
 *
 * Tolerant of:
 *  - Spaces in place of < (replaced before processing)
 *  - Lines up to 4 chars shorter than the canonical length (padded with <)
 *  - GPT returning all MRZ rows concatenated on a single line
 *  - TD1 lines in the 32–34 char range that would otherwise be mis-matched as TD2
 */
export function extractMRZFromText(text: string): string[] | null {
  if (!text) return null;

  // Replace spaces with < — spaces are never valid MRZ characters.
  const rawLines = text
    .split(/[\n\r]+/)
    .map((l) => l.replace(/ /g, "<").trim())
    .filter((l) => l.length >= 20);

  // ── Handle GPT returning all rows concatenated on one line ────────────────
  // GPT sometimes outputs the three TD1 or two TD3/TD2 rows as a single string.
  // Detect by total length and split at the expected row boundary.
  const expanded: string[] = [];
  for (const raw of rawLines) {
    // Strip non-MRZ chars to measure the usable length
    const clean = raw.replace(/[^A-Z0-9<]/gi, "").toUpperCase();
    if (clean.length >= 83 && clean.length <= 92) {
      // TD3: 2 × 44 = 88  (check BEFORE TD1 — shorter range is more specific)
      expanded.push(clean.substring(0, 44), clean.substring(44));
    } else if (clean.length >= 86 && clean.length <= 96) {
      // TD1: 3 × 30 = 90
      expanded.push(clean.substring(0, 30), clean.substring(30, 60), clean.substring(60));
    } else if (clean.length >= 68 && clean.length <= 78) {
      // TD2: 2 × 36 = 72
      expanded.push(clean.substring(0, 36), clean.substring(36));
    } else {
      expanded.push(raw);
    }
  }

  const lines = expanded
    .filter((l) => l.length >= 20)
    .map(normalizeLine)
    .filter((l) => /^[A-Z0-9<]{20,}$/.test(l));

  console.log("[MRZ lib] extractMRZFromText candidate lines:", JSON.stringify(lines.map(l => `${l.length}:${l}`)));

  if (lines.length === 0) return null;

  // ── TD1 checked FIRST (3 × 30) ───────────────────────────────────────────
  // Must precede TD2 because lines in the 32–34 char range can falsely match
  // TD2 [33,40] when they are actually slightly-long TD1 rows.
  for (let i = 0; i <= lines.length - 3; i++) {
    const a = lines[i], b = lines[i + 1], c = lines[i + 2];
    if (
      a.length >= 26 && a.length <= 34 &&
      b.length >= 26 && b.length <= 34 &&
      c.length >= 26 && c.length <= 34
    ) {
      return [padMRZ(a, 30), padMRZ(b, 30), padMRZ(c, 30)];
    }
  }

  // ── TD3 (2 × 44) ─────────────────────────────────────────────────────────
  for (let i = 0; i <= lines.length - 2; i++) {
    const a = lines[i], b = lines[i + 1];
    if (a.length >= 40 && a.length <= 48 && b.length >= 40 && b.length <= 48) {
      return [padMRZ(a, 44), padMRZ(b, 44)];
    }
  }

  // ── TD2 (2 × 36) ─────────────────────────────────────────────────────────
  for (let i = 0; i <= lines.length - 2; i++) {
    const a = lines[i], b = lines[i + 1];
    if (a.length >= 33 && a.length <= 40 && b.length >= 33 && b.length <= 40) {
      return [padMRZ(a, 36), padMRZ(b, 36)];
    }
  }

  // Fallback: return best 2+ lines as-is
  if (lines.length >= 2) return lines.slice(0, 3);
  return null;
}

/**
 * Quick validity check: does this look like valid MRZ text at all?
 */
export function looksLikeMRZ(text: string): boolean {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim());
  const mrzLike = lines.filter(
    (l) => l.length >= 28 && /^[A-Z0-9<\s]{28,}$/i.test(l)
  );
  return mrzLike.length >= 2;
}
