import { ParsedMRZ } from "./mrz";

export interface StoredResult {
  parsed: ParsedMRZ;
  thumbnailUri: string | null;
  scannedAt: Date;
}

let _result: StoredResult | null = null;

export function setLastResult(data: StoredResult): void {
  _result = data;
}

export function getLastResult(): StoredResult | null {
  return _result;
}

export function clearLastResult(): void {
  _result = null;
}
