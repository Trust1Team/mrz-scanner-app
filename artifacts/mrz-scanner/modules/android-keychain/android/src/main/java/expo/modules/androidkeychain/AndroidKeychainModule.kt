package expo.modules.androidkeychain

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.security.KeyChain
import android.security.KeyChainException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// ─── Shared-preference key ────────────────────────────────────────────────────
private const val PREFS_NAME  = "AndroidKeychainPrefs"
private const val KEY_ALIAS   = "selected_certificate_alias"

// ─── Module ───────────────────────────────────────────────────────────────────

class AndroidKeychainModule : Module() {

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── ISO-8601 formatter ────────────────────────────────────────────────────
    private val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun definition() = ModuleDefinition {

        Name("AndroidKeychain")

        // ── selectCertificate ─────────────────────────────────────────────────
        /**
         * Shows the system certificate picker (KeyChain.choosePrivateKeyAlias).
         * Must be called on the UI thread; expo-modules-core routes AsyncFunction
         * calls through the correct threading automatically.
         *
         * @param host  Optional server hostname to help the OS filter certs.
         * @param port  Optional server port (-1 = any).
         * @returns     The alias string, or null if the user cancelled.
         */
        AsyncFunction("selectCertificate") { host: String, port: Int, promise: Promise ->
            val activity: Activity = appContext.activityProvider?.currentActivity
                ?: run {
                    promise.reject("E_NO_ACTIVITY", "No foreground Activity available", null)
                    return@AsyncFunction
                }

            KeyChain.choosePrivateKeyAlias(
                activity,
                { alias: String? ->
                    if (alias != null) {
                        prefs.edit().putString(KEY_ALIAS, alias).apply()
                    }
                    promise.resolve(alias)
                },
                /* keyTypes  */ null,
                /* issuers   */ null,
                /* host      */ host.ifEmpty { null },
                /* port      */ port,
                /* alias     */ prefs.getString(KEY_ALIAS, null) // pre-select stored alias
            )
        }

        // ── getStoredAlias ────────────────────────────────────────────────────
        AsyncFunction("getStoredAlias") { promise: Promise ->
            promise.resolve(prefs.getString(KEY_ALIAS, null))
        }

        // ── hasCertificate ────────────────────────────────────────────────────
        /**
         * Returns true if an alias is stored AND the KeyChain still has the
         * corresponding private key (MDM may revoke/wipe it remotely).
         */
        AsyncFunction("hasCertificate") { promise: Promise ->
            val alias = prefs.getString(KEY_ALIAS, null)
            if (alias == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            // KeyChain.getPrivateKey is a blocking call — run on a background thread.
            Thread {
                try {
                    val key = KeyChain.getPrivateKey(context, alias)
                    promise.resolve(key != null)
                } catch (e: KeyChainException) {
                    promise.resolve(false)
                } catch (e: InterruptedException) {
                    promise.resolve(false)
                }
            }.start()
        }

        // ── getCertificateInfo ────────────────────────────────────────────────
        /**
         * Parses the stored certificate and returns human-readable metadata.
         * Blocking KeyChain calls run on a background thread.
         */
        AsyncFunction("getCertificateInfo") { promise: Promise ->
            val alias = prefs.getString(KEY_ALIAS, null)
            if (alias == null) {
                promise.resolve(null)
                return@AsyncFunction
            }
            Thread {
                try {
                    val chain: Array<X509Certificate>? =
                        KeyChain.getCertificateChain(context, alias)

                    if (chain.isNullOrEmpty()) {
                        promise.resolve(null)
                        return@Thread
                    }

                    val cert = chain[0]

                    // SHA-256 fingerprint
                    val md = java.security.MessageDigest.getInstance("SHA-256")
                    val raw = md.digest(cert.encoded)
                    val fingerprint = raw.joinToString(":") { "%02X".format(it) }

                    val info = mapOf(
                        "alias"            to alias,
                        "subject"          to cert.subjectX500Principal.name,
                        "issuer"           to cert.issuerX500Principal.name,
                        "validFrom"        to isoFmt.format(cert.notBefore),
                        "validTo"          to isoFmt.format(cert.notAfter),
                        "sha256Fingerprint" to fingerprint,
                        "serialNumber"     to cert.serialNumber.toString(16).uppercase()
                    )
                    promise.resolve(info)
                } catch (e: KeyChainException) {
                    promise.reject("E_KEYCHAIN", e.message ?: "KeyChain error", e)
                } catch (e: InterruptedException) {
                    promise.reject("E_INTERRUPTED", "KeyChain call interrupted", e)
                }
            }.start()
        }

        // ── clearCertificate ─────────────────────────────────────────────────
        AsyncFunction("clearCertificate") { promise: Promise ->
            prefs.edit().remove(KEY_ALIAS).apply()
            promise.resolve(null)
        }
    }
}
