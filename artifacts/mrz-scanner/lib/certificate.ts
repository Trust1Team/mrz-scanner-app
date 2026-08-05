/**
 * Certificate Service
 *
 * High-level wrapper around the AndroidKeychain native module.
 * Use this from React components and the future REST API client.
 *
 * Intune flow on Android:
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  IT Admin creates SCEP / PKCS certificate profile in Intune  │
 *  │  → Intune pushes it to enrolled Android devices              │
 *  │  → Certificate lands in the Android system KeyStore          │
 *  │  → This service exposes it to the app via Android KeyChain   │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * mTLS wiring (future REST client):
 *  When the REST client is implemented, call `getStoredAlias()` to retrieve
 *  the KeyChain alias, then pass it to the native OkHttp interceptor that
 *  will build the SSLContext from `KeyChain.getPrivateKey()` /
 *  `KeyChain.getCertificateChain()`.  The alias is the only value that
 *  needs to cross the JS/native boundary for mTLS — all crypto stays native.
 */

import {
  selectCertificate,
  getStoredAlias,
  hasCertificate,
  getCertificateInfo,
  clearCertificate,
  type CertificateInfo,
} from "../modules/android-keychain";

export type { CertificateInfo };

// ─── Status ──────────────────────────────────────────────────────────────────

export type CertificateStatus =
  | "not_selected"     // user hasn't picked a cert yet
  | "selected"         // alias stored, cert accessible
  | "unavailable"      // alias stored but cert gone (MDM revoked/wiped)
  | "unsupported";     // running on a platform that doesn't have KeyChain

/**
 * Determine the current certificate status without triggering a UI dialog.
 */
export async function getCertificateStatus(): Promise<CertificateStatus> {
  try {
    const alias = await getStoredAlias();
    if (!alias) return "not_selected";

    const available = await hasCertificate();
    return available ? "selected" : "unavailable";
  } catch {
    return "unsupported";
  }
}

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * Prompt the user to pick their Intune certificate from the system store.
 *
 * @param host  Hostname of the backend API (helps OS pre-filter suitable certs).
 * @param port  Port of the backend API (optional, pass 443 for HTTPS default).
 * @returns     `CertificateInfo` on success, `null` if the user cancelled.
 */
export async function promptCertificateSelection(
  host?: string,
  port = 443
): Promise<CertificateInfo | null> {
  const alias = await selectCertificate(host, port);
  if (!alias) return null;
  return getCertificateInfo();
}

// ─── Info ─────────────────────────────────────────────────────────────────────

export { getCertificateInfo, clearCertificate, getStoredAlias };

// ─── REST client integration point ───────────────────────────────────────────

/**
 * Returns the alias string needed to configure mTLS in the native REST client.
 *
 * Usage (future OkHttp interceptor):
 *
 *   const alias = await getAliasForMtls();
 *   if (alias) {
 *     NativeRestClient.setClientCertificateAlias(alias);
 *   }
 *
 * The native layer uses this alias to call:
 *   KeyChain.getPrivateKey(context, alias)       → javax.net.ssl.X509KeyManager
 *   KeyChain.getCertificateChain(context, alias) → X509Certificate[]
 * and builds the SSLContext that OkHttp uses for mutual TLS.
 */
export async function getAliasForMtls(): Promise<string | null> {
  try {
    const available = await hasCertificate();
    if (!available) return null;
    return getStoredAlias();
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw DN string (e.g. "CN=John Doe, O=Trust1Team, C=BE") into a map.
 * Useful for displaying individual fields (common name, org, country) in the UI.
 */
export function parseDN(dn: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match KEY=VALUE pairs, handling quoted values and commas inside values
  const re = /([A-Z]+)=([^,=]+(?:,(?![A-Z]+=)[^,=]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dn)) !== null) {
    result[m[1].trim()] = m[2].trim();
  }
  return result;
}

/**
 * Returns a friendly display name from certificate info.
 * Prefers CN, falls back to full subject string.
 */
export function certDisplayName(info: CertificateInfo): string {
  const parts = parseDN(info.subject);
  return parts["CN"] ?? info.subject;
}

/**
 * Returns true if the certificate is still within its validity period.
 */
export function isCertificateValid(info: CertificateInfo): boolean {
  const now = Date.now();
  return (
    now >= new Date(info.validFrom).getTime() &&
    now <= new Date(info.validTo).getTime()
  );
}
