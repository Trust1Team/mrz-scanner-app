/**
 * Android KeyChain module
 *
 * Wraps the Android KeyChain API to let the app access X.509 certificates
 * that Intune (or any MDM) deploys to the device's system credential store.
 *
 * Typical flow:
 *  1. Call `selectCertificate()` once — the OS shows a picker listing all
 *     certificates the user can grant access to.  The chosen alias is
 *     persisted in SharedPreferences so subsequent launches skip the dialog.
 *  2. Call `getCertificateInfo()` to show the user which cert is active.
 *  3. When the REST API client is implemented, it obtains the private key and
 *     cert chain via the native `buildMtlsSocketFactory()` call (exposed below)
 *     and configures OkHttp / Ktor accordingly.
 */

import { NativeModulesProxy, requireNativeModule } from "expo-modules-core";

// Android-only module — on web or iOS we return stubs so the app compiles.
const AndroidKeychain =
  typeof requireNativeModule === "function"
    ? (() => {
        try {
          return requireNativeModule("AndroidKeychain");
        } catch {
          return null;
        }
      })()
    : null;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CertificateInfo {
  /** KeyChain alias that identifies the key-pair */
  alias: string;
  /** Distinguished Name of the certificate subject  */
  subject: string;
  /** Distinguished Name of the issuer CA */
  issuer: string;
  /** ISO-8601 string of the "not before" date */
  validFrom: string;
  /** ISO-8601 string of the "not after" date */
  validTo: string;
  /** SHA-256 fingerprint (hex, colon-delimited) */
  sha256Fingerprint: string;
  /** Serial number (hex) */
  serialNumber: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Show the system certificate picker and persist the chosen alias.
 *
 * Pass `host` / `port` so the OS can pre-filter certs appropriate for
 * that server (optional but recommended).
 *
 * @returns The alias string if the user chose a certificate, or `null` if
 *          they cancelled.
 */
export async function selectCertificate(
  host?: string,
  port?: number
): Promise<string | null> {
  if (!AndroidKeychain) return null;
  return AndroidKeychain.selectCertificate(host ?? "", port ?? -1);
}

/**
 * Return the alias that was persisted by `selectCertificate()`, or `null`
 * if none has been selected yet.
 */
export async function getStoredAlias(): Promise<string | null> {
  if (!AndroidKeychain) return null;
  return AndroidKeychain.getStoredAlias();
}

/**
 * Return `true` if an alias has been stored **and** the key is still present
 * in the KeyChain (i.e. the cert hasn't been revoked/removed by MDM).
 */
export async function hasCertificate(): Promise<boolean> {
  if (!AndroidKeychain) return false;
  return AndroidKeychain.hasCertificate();
}

/**
 * Parse and return human-readable details about the currently selected
 * certificate.  Returns `null` if no certificate is stored.
 */
export async function getCertificateInfo(): Promise<CertificateInfo | null> {
  if (!AndroidKeychain) return null;
  return AndroidKeychain.getCertificateInfo();
}

/**
 * Remove the stored alias from SharedPreferences.
 * The next REST call (or explicit `selectCertificate()`) will re-prompt.
 */
export async function clearCertificate(): Promise<void> {
  if (!AndroidKeychain) return;
  return AndroidKeychain.clearCertificate();
}
