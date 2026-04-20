package `fun`.cashflow.signing

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.StoreBytesData
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.ConnectionResult
import org.json.JSONObject
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

@ReactModule(name = CashflowSigningModule.NAME)
class CashflowSigningModule(reactContext: ReactApplicationContext) :
    NativeCashflowSigningSpec(reactContext) {

  companion object {
    const val NAME = "CashflowSigning"
    private const val KEYSTORE_ALIAS = "fun.cashflow.signing.aes"
    private const val KEYSTORE_ALIAS_BIO = "fun.cashflow.signing.aes.bio"
    private const val KEYSTORE_ALIAS_BIO_V2 = "fun.cashflow.signing.aes.bio.v2"
    private const val PREFS_NAME = "fun.cashflow.signing"
    private const val GCM_TAG_LENGTH = 128
    private const val BIO_VALIDITY_SECONDS = 300 // 5 minutes — matches app lock timeout
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    // Hardcoded salt compiled into the binary — an attacker needs both the Keystore key AND
    // this salt to recover the seed. Must match iOS. Changing this invalidates all stored keys.
    private val AES_SALT = "cashflow:android:v1:9c5f2d7b".toByteArray(Charsets.UTF_8)
    private val HKDF_INFO = "aes-gcm-encryption".toByteArray(Charsets.UTF_8)
    // Block Store backup encryption (distinct from Keystore HKDF)
    private val BLOCKSTORE_SALT = "cashflow:blockstore:v1:a3e8f1c4".toByteArray(Charsets.UTF_8)
    private val BLOCKSTORE_HKDF_INFO = "blockstore-aes-gcm".toByteArray(Charsets.UTF_8)
    private const val BLOCKSTORE_KEY = "cf_cloud_backup"
    // Short timeout so a single biometric prompt (e.g. PIN retrieval) unlocks
    // the V2 key for subsequent operations (e.g. signing) within the same flow.
    private const val BIO_V2_TIMEOUT_SECONDS = 15
  }

  private fun isGmsAvailable(): Boolean {
    return GoogleApiAvailability.getInstance()
      .isGooglePlayServicesAvailable(reactApplicationContext) == ConnectionResult.SUCCESS
  }

  override fun getName(): String = NAME

  @ReactMethod
  override fun isGmsAvailable(promise: Promise) {
    promise.resolve(isGmsAvailable())
  }

  // --- PIN cache for cloud key encryption/decryption ---
  private var cachedPin: String? = null
  // Cached device seed — held in memory after first biometric-authenticated sign
  // to avoid repeated CryptoObject prompts within the same session.
  // Cleared when app locks (clearCachedPin).
  private var cachedDeviceSeed: ByteArray? = null

  @ReactMethod
  override fun cachePin(pin: String, promise: Promise) {
    cachedPin = pin
    promise.resolve(null)
  }

  @ReactMethod
  override fun clearCachedPin(promise: Promise) {
    cachedPin = null
    cachedDeviceSeed?.fill(0)
    cachedDeviceSeed = null
    promise.resolve(null)
  }

  @ReactMethod
  override fun storePinForBiometric(pin: String, promise: Promise) {
    try {
      if (!isBiometricAvailable()) {
        promise.resolve(null)
        return
      }
      val prefs = getPrefs()
      if (prefs.getBoolean("bio_pin_v2", false)) {
        promise.resolve(null)
        return
      }
      // Encrypt with V2 biometric Keystore key. If the timer is active (from a
      // recent biometric prompt in retrievePinWithBiometric), this succeeds silently.
      // Otherwise falls back to showing a biometric prompt.
      val pinBytes = pin.toByteArray(Charsets.UTF_8)
      encryptWithBiometricV2(pinBytes, "Enable biometric unlock") { encrypted, error ->
        if (error != null || encrypted == null) {
          promise.resolve(null)
          return@encryptWithBiometricV2
        }
        prefs.edit()
          .putString("bio_pin", Base64.encodeToString(encrypted, Base64.NO_WRAP))
          .putBoolean("bio_pin_v2", true)
          .apply()
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  override fun retrievePinWithBiometric(promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("bio_pin", null)
      if (encryptedBase64 == null) {
        promise.resolve(null)
        return
      }
      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)
      val isV2 = prefs.getBoolean("bio_pin_v2", false)

      if (isV2) {
        // V2: bio_pin encrypted with V2 biometric Keystore key.
        // decryptWithBiometricV2 tries synchronously first (timer may be active),
        // then shows biometric prompt if timer expired. The prompt resets the V2 key
        // timer for 15 seconds, so subsequent operations (storePinForBiometric, sign)
        // proceed without additional prompts.
        decryptWithBiometricV2(encrypted, "Unlock Cashflow") { pinBytes, error ->
          if (error != null || pinBytes == null) {
            promise.resolve(null)
            return@decryptWithBiometricV2
          }
          val pin = String(pinBytes, Charsets.UTF_8)
          cachedPin = pin
          pinBytes.fill(0)
          promise.resolve(pin)
        }
      } else {
        // Legacy bio_pin — decrypt with old timer-based biometric Keystore key
        decryptWithLegacyBio(encrypted, "Unlock Cashflow") { pinBytes, error ->
          if (error != null || pinBytes == null) {
            promise.resolve(null)
            return@decryptWithLegacyBio
          }
          val pin = String(pinBytes, Charsets.UTF_8)
          cachedPin = pin
          pinBytes.fill(0)
          promise.resolve(pin)
        }
      }
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  override fun reEncryptCloudKeyWithPin(newPin: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("cloud_seed", null)
        ?: throw Exception("No cloud keypair found")
      val pubBase64 = prefs.getString("cloud_pub", null)
        ?: throw Exception("No cloud public key found")

      val oldPin = cachedPin ?: throw Exception("No PIN cached — unlock first")
      val pubBytes = Base64.decode(pubBase64, Base64.NO_WRAP)
      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)

      // Decrypt with old PIN
      val seed = decryptWithPin(encrypted, pubBytes, oldPin)
      try {
        // Re-encrypt with new PIN
        val reEncrypted = encryptWithPin(seed, pubBytes, newPin)
        prefs.edit()
          .putString("cloud_seed", Base64.encodeToString(reEncrypted, Base64.NO_WRAP))
          .apply()

        // Update cached PIN and force bio_pin re-encryption on next storePinForBiometric
        cachedPin = newPin
        prefs.edit().remove("bio_pin_v2").apply()

        // Also re-backup to Block Store with new PIN
        backupToBlockStoreInternal(seed, pubBytes, newPin, promise)
      } finally {
        seed.fill(0)
      }
    } catch (e: Exception) {
      promise.reject("ERR_REENCRYPT", "Failed to re-encrypt cloud key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun generateKeypair(tag: String, cloudSync: Boolean, promise: Promise) {
    try {
      val keyPairGenerator = Ed25519KeyPairGenerator()
      keyPairGenerator.init(Ed25519KeyGenerationParameters(java.security.SecureRandom()))
      val keyPair = keyPairGenerator.generateKeyPair()

      val privateKeyParams = keyPair.private as Ed25519PrivateKeyParameters
      val publicKeyParams = keyPair.public as Ed25519PublicKeyParameters

      val seed = privateKeyParams.encoded
      val pubKey = publicKeyParams.encoded
      val useBio = !cloudSync && isBiometricAvailable()

      if (useBio) {
        // Device key: biometric-protected Keystore encryption (per-use CryptoObject)
        encryptWithBiometricV2(seed, "Secure your signing key") { encrypted, error ->
          if (error != null || encrypted == null) {
            seed.fill(0)
            promise.reject("ERR_KEYGEN", "Failed to generate keypair: ${error?.message ?: "authentication required"}", error)
            return@encryptWithBiometricV2
          }
          val prefs = getPrefs()
          prefs.edit()
            .putString("${tag}_seed", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("${tag}_pub", Base64.encodeToString(pubKey, Base64.NO_WRAP))
            .putBoolean("${tag}_bio", true)
            .putBoolean("${tag}_bio_v2", true)
            .apply()
          seed.fill(0)
          promise.resolve(base58Encode(pubKey))
        }
      } else if (cloudSync && cachedPin != null) {
        // Cloud key: PIN-based encryption (same scheme as Block Store)
        val encrypted = encryptWithPin(seed, pubKey, cachedPin!!)
        saveAndResolve(tag, seed, pubKey, encrypted, useBio = false, promise)
      } else {
        // Fallback: Keystore encryption (no PIN available)
        val encrypted = encryptWithKeystore(seed, biometric = false)
        saveAndResolve(tag, seed, pubKey, encrypted, useBio = false, promise)
      }
    } catch (e: Exception) {
      promise.reject("ERR_KEYGEN", "Failed to generate keypair: ${e.message}", e)
    }
  }

  private fun saveAndResolve(
    tag: String,
    seed: ByteArray,
    pubKey: ByteArray,
    encrypted: ByteArray,
    useBio: Boolean,
    promise: Promise,
  ) {
    val prefs = getPrefs()
    prefs.edit()
      .putString("${tag}_seed", Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .putString("${tag}_pub", Base64.encodeToString(pubKey, Base64.NO_WRAP))
      .putBoolean("${tag}_bio", useBio)
      .apply()

    seed.fill(0)
    promise.resolve(base58Encode(pubKey))
  }

  @ReactMethod
  override fun getPublicKey(tag: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val pubBase64 = prefs.getString("${tag}_pub", null)
      if (pubBase64 == null) {
        promise.resolve(null)
        return
      }
      val pubKey = Base64.decode(pubBase64, Base64.NO_WRAP)
      promise.resolve(base58Encode(pubKey))
    } catch (e: Exception) {
      promise.reject("ERR_GET_KEY", "Failed to get public key: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun exportPrivateKey(tag: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("${tag}_seed", null)
      if (encryptedBase64 == null) {
        promise.resolve(null)
        return
      }
      val useBio = prefs.getBoolean("${tag}_bio", false)
      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)

      if (useBio) {
        val isV2 = prefs.getBoolean("${tag}_bio_v2", false)
        val decryptFn = if (isV2) ::decryptWithBiometricV2 else ::decryptWithLegacyBio
        decryptFn(encrypted, "Authenticate to export key") { seed, error ->
          if (error != null) {
            promise.reject("ERR_EXPORT", "Failed to export private key: ${error.message}", error)
            return@decryptFn
          }
          try {
            val privateKey = Ed25519PrivateKeyParameters(seed!!, 0)
            val pubKey = privateKey.generatePublicKey().encoded
            val fullKeypair = seed + pubKey
            promise.resolve(base58Encode(fullKeypair))
          } finally {
            seed!!.fill(0)
          }
        }
      } else {
        // Cloud key: decrypt with cached PIN; fallback to Keystore for legacy data
        val seed = decryptSeed(tag, encrypted)
        try {
          val privateKey = Ed25519PrivateKeyParameters(seed, 0)
          val pubKey = privateKey.generatePublicKey().encoded
          val fullKeypair = seed + pubKey
          promise.resolve(base58Encode(fullKeypair))
        } finally {
          seed.fill(0)
        }
      }
    } catch (e: Exception) {
      promise.reject("ERR_EXPORT", "Failed to export private key: ${e.message}", e)
    }
  }

  /** Helper: sign a message with a seed (does NOT zero-fill — caller manages lifecycle). */
  private fun signAndResolve(seed: ByteArray, messageBase64: String, promise: Promise) {
    val message = Base64.decode(messageBase64, Base64.NO_WRAP)
    val privateKey = Ed25519PrivateKeyParameters(seed, 0)
    val signer = Ed25519Signer()
    signer.init(true, privateKey)
    signer.update(message, 0, message.size)
    val signature = signer.generateSignature()
    promise.resolve(Base64.encodeToString(signature, Base64.NO_WRAP))
  }

  @ReactMethod
  override fun sign(tag: String, messageBase64: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("${tag}_seed", null)
        ?: throw Exception("No keypair found for tag: $tag")
      val useBio = prefs.getBoolean("${tag}_bio", false)
      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)

      if (useBio) {
        // Use cached seed if available (avoids repeated biometric prompts within session)
        val cached = cachedDeviceSeed
        if (cached != null) {
          signAndResolve(cached, messageBase64, promise)
          return
        }

        val isV2 = prefs.getBoolean("${tag}_bio_v2", false)
        if (isV2) {
          // V2 per-use CryptoObject path — biometric prompt bound to cipher
          decryptWithBiometricV2(encrypted, "Authenticate to sign") { seed, error ->
            if (error != null) {
              promise.reject("ERR_SIGN", "Failed to sign: ${error.message}", error)
              return@decryptWithBiometricV2
            }
            cachedDeviceSeed = seed!!.clone()
            signAndResolve(seed, messageBase64, promise)
          }
        } else {
          // Legacy timer-based key — decrypt, sign, then migrate to V2 in background
          decryptWithLegacyBio(encrypted, "Authenticate to sign") { seed, error ->
            if (error != null) {
              promise.reject("ERR_SIGN", "Failed to sign: ${error.message}", error)
              return@decryptWithLegacyBio
            }
            cachedDeviceSeed = seed!!.clone()
            signAndResolve(seed, messageBase64, promise)

            // Migrate to V2 in background — re-encrypt seed with per-use CryptoObject key
            val seedForMigration = cachedDeviceSeed!!.clone()
            encryptWithBiometricV2(seedForMigration, "Secure your signing key") { newEncrypted, encErr ->
              if (encErr == null && newEncrypted != null) {
                prefs.edit()
                  .putString("${tag}_seed", Base64.encodeToString(newEncrypted, Base64.NO_WRAP))
                  .putBoolean("${tag}_bio_v2", true)
                  .apply()
              }
              seedForMigration.fill(0)
            }
          }
        }
      } else {
        // PIN-based or legacy Keystore decryption
        val seed = decryptSeed(tag, encrypted)
        try {
          signAndResolve(seed, messageBase64, promise)
        } finally {
          seed.fill(0)
        }
      }
    } catch (e: Exception) {
      promise.reject("ERR_SIGN", "Failed to sign: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun hasKeypair(tag: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      promise.resolve(prefs.contains("${tag}_seed"))
    } catch (e: Exception) {
      promise.reject("ERR_HAS_KEY", "Failed to check keypair: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun deleteKeypair(tag: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      prefs.edit()
        .remove("${tag}_seed")
        .remove("${tag}_pub")
        .remove("${tag}_bio")
        .remove("${tag}_bio_v2")
        .apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERR_DELETE", "Failed to delete keypair: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun authenticate(reason: String, promise: Promise) {
    val activity = currentActivity as? FragmentActivity
    if (activity == null) {
      promise.resolve(true) // No activity — allow access
      return
    }

    if (!isBiometricAvailable()) {
      promise.resolve(true) // No biometrics — allow access
      return
    }

    val executor = ContextCompat.getMainExecutor(reactApplicationContext)
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        promise.resolve(true)
      }
      override fun onAuthenticationFailed() {
        // Called on individual attempt failure — wait for error or success
      }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        promise.resolve(false)
      }
    }

    activity.runOnUiThread {
      val prompt = BiometricPrompt(activity, executor, callback)
      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Cashflow")
        .setSubtitle(reason)
        .setAllowedAuthenticators(
          BiometricManager.Authenticators.BIOMETRIC_STRONG or
          BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )
        .build()
      prompt.authenticate(promptInfo)
    }
  }

  @ReactMethod
  override fun migrateKeypairsToBiometric(promise: Promise) {
    val prefs = getPrefs()
    if (prefs.getBoolean("biometric_migrated", false)) {
      promise.resolve(false)
      return
    }

    if (!isBiometricAvailable()) {
      prefs.edit().putBoolean("biometric_migrated", true).apply()
      promise.resolve(false)
      return
    }

    try {
      // Migrate device key: decrypt with old key, re-encrypt with biometric key
      val encryptedBase64 = prefs.getString("device_seed", null)
      val alreadyBio = prefs.getBoolean("device_bio", false)
      if (encryptedBase64 != null && !alreadyBio) {
        val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)
        val seed = decryptWithKeystore(encrypted, biometric = false)
        try {
          val reEncrypted = encryptWithKeystore(seed, biometric = true)
          prefs.edit()
            .putString("device_seed", Base64.encodeToString(reEncrypted, Base64.NO_WRAP))
            .putBoolean("device_bio", true)
            .putBoolean("biometric_migrated", true)
            .apply()
        } finally {
          seed.fill(0)
        }
        promise.resolve(true)
      } else {
        prefs.edit().putBoolean("biometric_migrated", true).apply()
        promise.resolve(false)
      }
    } catch (e: Exception) {
      promise.reject("ERR_MIGRATE", "Failed to migrate keypairs: ${e.message}", e)
    }
  }

  // --- Biometric helpers ---

  private fun isBiometricAvailable(): Boolean {
    val manager = BiometricManager.from(reactApplicationContext)
    return manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
      BiometricManager.BIOMETRIC_SUCCESS
  }

  // --- V2 per-use CryptoObject biometric operations ---
  // The V2 key uses setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)
  // which requires CryptoObject for every operation. This avoids the Android 11+
  // timer issue where BiometricPrompt without CryptoObject doesn't reset the
  // Keystore auth timer for keys created with the deprecated validity-seconds API.

  private fun getOrCreateAesKeyV2(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)

    // If the key was created with per-use (timeout=0) from a previous build, delete it
    // so it gets recreated with the correct timeout-based parameters.
    if (!getPrefs().getBoolean("bio_v2_timeout_key", false)) {
      if (keyStore.containsAlias(KEYSTORE_ALIAS_BIO_V2)) {
        keyStore.deleteEntry(KEYSTORE_ALIAS_BIO_V2)
        getPrefs().edit()
          .remove("bio_pin_v2")
          .remove("device_bio_v2")
          .putBoolean("bio_v2_timeout_key", true)
          .apply()
      } else {
        getPrefs().edit().putBoolean("bio_v2_timeout_key", true).apply()
      }
    }

    val existingKey = keyStore.getEntry(KEYSTORE_ALIAS_BIO_V2, null)
    if (existingKey is KeyStore.SecretKeyEntry) {
      return existingKey.secretKey
    }

    val builder = KeyGenParameterSpec.Builder(
      KEYSTORE_ALIAS_BIO_V2,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setUserAuthenticationRequired(true)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // Explicit AUTH_BIOMETRIC_STRONG — standalone BiometricPrompt resets the timer.
      // Unlike the deprecated setUserAuthenticationValidityDurationSeconds which maps
      // to AUTH_DEVICE_CREDENTIAL only on Android 11+.
      builder.setUserAuthenticationParameters(BIO_V2_TIMEOUT_SECONDS, KeyProperties.AUTH_BIOMETRIC_STRONG)
    } else {
      @Suppress("DEPRECATION")
      builder.setUserAuthenticationValidityDurationSeconds(BIO_V2_TIMEOUT_SECONDS)
    }

    val keyGenerator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
    )
    keyGenerator.init(builder.build())
    return keyGenerator.generateKey()
  }

  /** Synchronous encrypt with V2 key. Throws UserNotAuthenticatedException if timer expired. */
  private fun encryptWithKeystoreV2(plaintext: ByteArray): ByteArray {
    val mask = hkdfDerive(plaintext.size)
    val masked = ByteArray(plaintext.size) { i -> (plaintext[i].toInt() xor mask[i].toInt()).toByte() }
    val key = getOrCreateAesKeyV2()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(masked)
    return byteArrayOf(ENCRYPT_VERSION_V2) + iv + ciphertext
  }

  /** Synchronous decrypt with V2 key. Throws UserNotAuthenticatedException if timer expired. */
  private fun decryptWithKeystoreV2(data: ByteArray): ByteArray {
    val hasV2Prefix = data.isNotEmpty() && data[0] == ENCRYPT_VERSION_V2
    val payload = if (hasV2Prefix) data.copyOfRange(1, data.size) else data
    val key = getOrCreateAesKeyV2()
    val iv = payload.copyOfRange(0, 12)
    val ciphertext = payload.copyOfRange(12, payload.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
    val decrypted = cipher.doFinal(ciphertext)
    if (!hasV2Prefix) return decrypted
    val mask = hkdfDerive(decrypted.size)
    return ByteArray(decrypted.size) { i -> (decrypted[i].toInt() xor mask[i].toInt()).toByte() }
  }

  /**
   * Encrypt with V2 biometric Keystore key. Tries synchronously first (timer may be
   * active from a recent biometric prompt). If timer expired, shows a standalone
   * BiometricPrompt to reset it, then retries.
   */
  private fun encryptWithBiometricV2(
    plaintext: ByteArray,
    reason: String,
    callback: (ByteArray?, Exception?) -> Unit
  ) {
    try {
      val encrypted = encryptWithKeystoreV2(plaintext)
      callback(encrypted, null)
      return
    } catch (_: UserNotAuthenticatedException) {
      // Timer expired — need biometric
    } catch (e: KeyPermanentlyInvalidatedException) {
      try { val ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(KEYSTORE_ALIAS_BIO_V2) } catch (_: Exception) {}
      getPrefs().edit().remove("bio_v2_timeout_key").apply()
      encryptWithBiometricV2(plaintext, reason, callback)
      return
    } catch (e: Exception) {
      callback(null, e)
      return
    }

    promptBiometricStrong(reason) { success, error ->
      if (!success) { callback(null, error); return@promptBiometricStrong }
      try {
        val encrypted = encryptWithKeystoreV2(plaintext)
        callback(encrypted, null)
      } catch (e: Exception) {
        callback(null, e)
      }
    }
  }

  /**
   * Decrypt with V2 biometric Keystore key. Tries synchronously first (timer may be
   * active from a recent biometric prompt). If timer expired, shows a standalone
   * BiometricPrompt to reset it, then retries.
   */
  private fun decryptWithBiometricV2(
    data: ByteArray,
    reason: String,
    callback: (ByteArray?, Exception?) -> Unit
  ) {
    try {
      val decrypted = decryptWithKeystoreV2(data)
      callback(decrypted, null)
      return
    } catch (_: UserNotAuthenticatedException) {
      // Timer expired — need biometric
    } catch (e: KeyPermanentlyInvalidatedException) {
      callback(null, Exception("Biometric key invalidated — please re-create your wallet key"))
      return
    } catch (e: Exception) {
      callback(null, e)
      return
    }

    promptBiometricStrong(reason) { success, error ->
      if (!success) { callback(null, error); return@promptBiometricStrong }
      try {
        val decrypted = decryptWithKeystoreV2(data)
        callback(decrypted, null)
      } catch (e: Exception) {
        callback(null, e)
      }
    }
  }

  /** Standalone BiometricPrompt with BIOMETRIC_STRONG — resets V2 key timer. */
  private fun promptBiometricStrong(reason: String, onResult: (Boolean, Exception?) -> Unit) {
    val activity = currentActivity as? FragmentActivity
    if (activity == null) {
      onResult(false, Exception("No activity available for biometric prompt"))
      return
    }

    val executor = ContextCompat.getMainExecutor(reactApplicationContext)
    val callback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        onResult(true, null)
      }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        onResult(false, Exception("$errString"))
      }
    }

    activity.runOnUiThread {
      val prompt = BiometricPrompt(activity, executor, callback)
      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Cashflow")
        .setSubtitle(reason)
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .setNegativeButtonText("Cancel")
        .build()
      prompt.authenticate(promptInfo)
    }
  }

  // --- Legacy timer-based biometric decrypt (for migration from old key format) ---

  private fun decryptWithLegacyBio(
    data: ByteArray,
    reason: String,
    callback: (ByteArray?, Exception?) -> Unit
  ) {
    try {
      // First try without prompting (within validity window)
      val seed = decryptWithKeystore(data, biometric = true)
      callback(seed, null)
      return
    } catch (e: UserNotAuthenticatedException) {
      // Need to authenticate first
    } catch (e: Exception) {
      callback(null, e)
      return
    }

    // Prompt for biometric, then retry decrypt
    val activity = currentActivity as? FragmentActivity
    if (activity == null) {
      callback(null, Exception("No activity available for biometric prompt"))
      return
    }

    val executor = ContextCompat.getMainExecutor(reactApplicationContext)
    val bioCallback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        try {
          val seed = decryptWithKeystore(data, biometric = true)
          callback(seed, null)
        } catch (e: UserNotAuthenticatedException) {
          // Biometric didn't reset Keystore timer (Android 11+ with deprecated API).
          // Fall back to device credential prompt.
          promptDeviceCredentialThenDecrypt(data, activity, callback)
        } catch (e: Exception) {
          callback(null, e)
        }
      }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        callback(null, Exception("Authentication cancelled: $errString"))
      }
    }

    activity.runOnUiThread {
      val prompt = BiometricPrompt(activity, executor, bioCallback)
      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Cashflow")
        .setSubtitle(reason)
        .setAllowedAuthenticators(
          BiometricManager.Authenticators.BIOMETRIC_STRONG or
          BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )
        .build()
      prompt.authenticate(promptInfo)
    }
  }

  /**
   * Device credential fallback for legacy timer-based keys on Android 11+.
   */
  private fun promptDeviceCredentialThenDecrypt(
    data: ByteArray,
    activity: FragmentActivity,
    callback: (ByteArray?, Exception?) -> Unit
  ) {
    val executor = ContextCompat.getMainExecutor(reactApplicationContext)
    val credCallback = object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        try {
          val seed = decryptWithKeystore(data, biometric = true)
          callback(seed, null)
        } catch (e: Exception) {
          callback(null, e)
        }
      }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        callback(null, Exception("Device credential required: $errString"))
      }
    }

    activity.runOnUiThread {
      val prompt = BiometricPrompt(activity, executor, credCallback)
      val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Cashflow")
        .setSubtitle("Enter device PIN to continue")
        .setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        .build()
      prompt.authenticate(promptInfo)
    }
  }

  // --- AES-GCM Envelope Encryption via Android Keystore ---

  private fun getOrCreateAesKey(biometric: Boolean): SecretKey {
    val alias = if (biometric) KEYSTORE_ALIAS_BIO else KEYSTORE_ALIAS
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)

    val existingKey = keyStore.getEntry(alias, null)
    if (existingKey is KeyStore.SecretKeyEntry) {
      return existingKey.secretKey
    }

    val keyGenerator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
    )
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)

    if (biometric) {
      builder.setUserAuthenticationRequired(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        builder.setUserAuthenticationParameters(
          BIO_VALIDITY_SECONDS,
          KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
        )
      } else {
        @Suppress("DEPRECATION")
        builder.setUserAuthenticationValidityDurationSeconds(BIO_VALIDITY_SECONDS)
      }
    }

    keyGenerator.init(builder.build())
    return keyGenerator.generateKey()
  }

  // Version byte prefixed to encrypted data to distinguish HKDF-masked (v2) from plain (v1)
  private val ENCRYPT_VERSION_V2: Byte = 0x02

  private fun encryptWithKeystore(plaintext: ByteArray, biometric: Boolean = false): ByteArray {
    // XOR plaintext with HKDF-derived mask before Keystore encryption
    // This ensures the Keystore key alone can't recover the seed without the salt
    val mask = hkdfDerive(plaintext.size)
    val masked = ByteArray(plaintext.size) { i -> (plaintext[i].toInt() xor mask[i].toInt()).toByte() }

    val key = getOrCreateAesKey(biometric)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(masked)
    // Prefix with version byte so decryptWithKeystore knows to un-XOR
    return byteArrayOf(ENCRYPT_VERSION_V2) + iv + ciphertext
  }

  private fun decryptWithKeystore(data: ByteArray, biometric: Boolean = false): ByteArray {
    // Check if data has v2 prefix (HKDF-masked)
    val hasV2Prefix = data.isNotEmpty() && data[0] == ENCRYPT_VERSION_V2
    val payload = if (hasV2Prefix) data.copyOfRange(1, data.size) else data

    val key = getOrCreateAesKey(biometric)
    val iv = payload.copyOfRange(0, 12)
    val ciphertext = payload.copyOfRange(12, payload.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
    val decrypted = cipher.doFinal(ciphertext)

    if (!hasV2Prefix) {
      // v1 data: no HKDF mask was applied
      return decrypted
    }

    // v2 data: un-XOR with the same HKDF-derived mask
    val mask = hkdfDerive(decrypted.size)
    return ByteArray(decrypted.size) { i -> (decrypted[i].toInt() xor mask[i].toInt()).toByte() }
  }

  /// HKDF-SHA256 key derivation using the hardcoded salt to produce a mask of the given length.
  private fun hkdfDerive(length: Int): ByteArray {
    // HKDF-Extract: PRK = HMAC-SHA256(salt, IKM=salt) — salt serves as both
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(AES_SALT, "HmacSHA256"))
    val prk = mac.doFinal(AES_SALT)

    // HKDF-Expand: generate enough bytes
    val result = ByteArray(length)
    var t = ByteArray(0)
    var offset = 0
    var counter: Byte = 1
    while (offset < length) {
      mac.init(SecretKeySpec(prk, "HmacSHA256"))
      mac.update(t)
      mac.update(HKDF_INFO)
      mac.update(counter)
      t = mac.doFinal()
      val toCopy = minOf(t.size, length - offset)
      System.arraycopy(t, 0, result, offset, toCopy)
      offset += toCopy
      counter++
    }
    return result
  }

  // --- PIN-based encryption for cloud keys (same scheme as Block Store) ---

  /** Version prefix for PIN-encrypted data to distinguish from Keystore-encrypted data. */
  private val ENCRYPT_VERSION_PIN: Byte = 0x03

  /** Encrypt seed with HKDF(salt, pubkey + pin) — no Keystore involved. */
  private fun encryptWithPin(seed: ByteArray, pubKey: ByteArray, pin: String): ByteArray {
    val ikm = pubKey + pin.toByteArray(Charsets.UTF_8)
    val derivedKey = hkdfDeriveBlockStore(ikm, 32)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(derivedKey, "AES"))
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(seed)
    // Prefix with version byte so decryptSeed knows to use PIN-based decryption
    return byteArrayOf(ENCRYPT_VERSION_PIN) + iv + ciphertext
  }

  /** Decrypt seed with HKDF(salt, pubkey + pin). */
  private fun decryptWithPin(data: ByteArray, pubKey: ByteArray, pin: String): ByteArray {
    // Strip version prefix if present
    val payload = if (data.isNotEmpty() && data[0] == ENCRYPT_VERSION_PIN) data.copyOfRange(1, data.size) else data
    val ikm = pubKey + pin.toByteArray(Charsets.UTF_8)
    val derivedKey = hkdfDeriveBlockStore(ikm, 32)
    val iv = payload.copyOfRange(0, 12)
    val ciphertext = payload.copyOfRange(12, payload.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(derivedKey, "AES"), GCMParameterSpec(GCM_TAG_LENGTH, iv))
    return cipher.doFinal(ciphertext)
  }

  /**
   * Decrypt a seed from SharedPreferences, auto-detecting the encryption format:
   * - v3 (ENCRYPT_VERSION_PIN): PIN-based → uses cachedPin
   * - v2/v1: Keystore-based → uses decryptWithKeystore (legacy)
   */
  private fun decryptSeed(tag: String, encrypted: ByteArray): ByteArray {
    if (encrypted.isNotEmpty() && encrypted[0] == ENCRYPT_VERSION_PIN) {
      // PIN-encrypted
      val pin = cachedPin ?: throw Exception("No PIN cached — unlock first")
      val prefs = getPrefs()
      val pubBase64 = prefs.getString("${tag}_pub", null)
        ?: throw Exception("No public key found for tag: $tag")
      val pubBytes = Base64.decode(pubBase64, Base64.NO_WRAP)
      return decryptWithPin(encrypted, pubBytes, pin)
    }
    // Legacy Keystore-encrypted data
    return decryptWithKeystore(encrypted, biometric = false)
  }

  /** Internal helper: backup seed to Block Store (used by both backup and re-encrypt). */
  private fun backupToBlockStoreInternal(seed: ByteArray, pubBytes: ByteArray, pin: String, promise: Promise) {
    if (!isGmsAvailable()) {
      promise.resolve(null)
      return
    }
    val pubBase58 = base58Encode(pubBytes)
    val ikm = pubBytes + pin.toByteArray(Charsets.UTF_8)
    val derivedKey = hkdfDeriveBlockStore(ikm, 32)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(derivedKey, "AES"))
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(seed)
    val encPayload = iv + ciphertext

    val json = JSONObject()
    json.put("pub", pubBase58)
    json.put("enc", Base64.encodeToString(encPayload, Base64.NO_WRAP))
    val payload = json.toString().toByteArray(Charsets.UTF_8)

    val storeData = StoreBytesData.Builder()
      .setBytes(payload)
      .setKey(BLOCKSTORE_KEY)
      .setShouldBackupToCloud(true)
      .build()
    Blockstore.getClient(reactApplicationContext).storeBytes(storeData)
      .addOnSuccessListener { promise.resolve(null) }
      .addOnFailureListener { e ->
        promise.reject("ERR_BLOCKSTORE", "Block Store backup failed: ${e.message}", e)
      }
  }

  private fun getPrefs(): SharedPreferences {
    return reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  // --- Block Store backup ---

  @ReactMethod
  override fun backupCloudKeyToBlockStore(pin: String, promise: Promise) {
    if (!isGmsAvailable()) {
      promise.reject("ERR_NO_GMS", "Google Play Services not available — Block Store backup skipped")
      return
    }
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("cloud_seed", null)
        ?: throw Exception("No cloud keypair to back up")
      val pubBase64 = prefs.getString("cloud_pub", null)
        ?: throw Exception("No cloud public key found")

      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)
      val pubBytes = Base64.decode(pubBase64, Base64.NO_WRAP)

      // Decrypt seed — auto-detects PIN-based (v3) vs Keystore (v1/v2)
      val seed = decryptSeed("cloud", encrypted)
      try {
        backupToBlockStoreInternal(seed, pubBytes, pin, promise)
      } finally {
        seed.fill(0)
      }
    } catch (e: Exception) {
      promise.reject("ERR_BLOCKSTORE", "Block Store backup failed: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun restoreCloudKeyFromBlockStore(pin: String, promise: Promise) {
    if (!isGmsAvailable()) {
      promise.reject("ERR_NO_GMS", "Google Play Services not available")
      return
    }
    try {
      val request = RetrieveBytesRequest.Builder()
        .setKeys(listOf(BLOCKSTORE_KEY))
        .build()
      Blockstore.getClient(reactApplicationContext).retrieveBytes(request)
        .addOnSuccessListener { result ->
          try {
            val blockData = result.blockstoreDataMap[BLOCKSTORE_KEY]
            if (blockData == null || blockData.bytes.isEmpty()) {
              promise.reject("ERR_NO_BACKUP", "No cloud key backup found in Block Store")
              return@addOnSuccessListener
            }

            val json = JSONObject(String(blockData.bytes, Charsets.UTF_8))
            val pubBase58 = json.getString("pub")
            val encBase64 = json.getString("enc")

            val pubBytes = base58Decode(pubBase58)
            val encPayload = Base64.decode(encBase64, Base64.NO_WRAP)

            // Derive same key: HKDF(salt, pubkey + pin)
            val ikm = pubBytes + pin.toByteArray(Charsets.UTF_8)
            val derivedKey = hkdfDeriveBlockStore(ikm, 32)

            // Decrypt: first 12 bytes = IV, rest = ciphertext + tag
            val iv = encPayload.copyOfRange(0, 12)
            val ciphertext = encPayload.copyOfRange(12, encPayload.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(derivedKey, "AES"), GCMParameterSpec(GCM_TAG_LENGTH, iv))
            val seed = cipher.doFinal(ciphertext)

            try {
              // Verify: derive pubkey from seed and check it matches
              val privateKey = Ed25519PrivateKeyParameters(seed, 0)
              val derivedPub = privateKey.generatePublicKey().encoded
              if (!derivedPub.contentEquals(pubBytes)) {
                promise.reject("ERR_WRONG_PIN", "Incorrect PIN — public key mismatch")
                return@addOnSuccessListener
              }

              // Re-encrypt with local Keystore and save to SharedPreferences
              val localEncrypted = encryptWithKeystore(seed, biometric = false)
              val prefs = getPrefs()
              prefs.edit()
                .putString("cloud_seed", Base64.encodeToString(localEncrypted, Base64.NO_WRAP))
                .putString("cloud_pub", Base64.encodeToString(pubBytes, Base64.NO_WRAP))
                .putBoolean("cloud_bio", false)
                .apply()

              promise.resolve(pubBase58)
            } finally {
              seed.fill(0)
            }
          } catch (e: javax.crypto.AEADBadTagException) {
            promise.reject("ERR_WRONG_PIN", "Incorrect PIN")
          } catch (e: Exception) {
            promise.reject("ERR_BLOCKSTORE", "Failed to restore from Block Store: ${e.message}", e)
          }
        }
        .addOnFailureListener { e ->
          promise.reject("ERR_BLOCKSTORE", "Block Store retrieval failed: ${e.message}", e)
        }
    } catch (e: Exception) {
      promise.reject("ERR_BLOCKSTORE", "Block Store restore failed: ${e.message}", e)
    }
  }

  @ReactMethod
  override fun hasBlockStoreBackup(promise: Promise) {
    if (!isGmsAvailable()) {
      promise.resolve(false)
      return
    }
    try {
      val request = RetrieveBytesRequest.Builder()
        .setKeys(listOf(BLOCKSTORE_KEY))
        .build()
      Blockstore.getClient(reactApplicationContext).retrieveBytes(request)
        .addOnSuccessListener { result ->
          val blockData = result.blockstoreDataMap[BLOCKSTORE_KEY]
          promise.resolve(blockData != null && blockData.bytes.isNotEmpty())
        }
        .addOnFailureListener {
          promise.resolve(false)
        }
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /** HKDF-SHA256 for Block Store encryption — uses caller-provided IKM (pubkey + pin). */
  private fun hkdfDeriveBlockStore(ikm: ByteArray, length: Int): ByteArray {
    // HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(BLOCKSTORE_SALT, "HmacSHA256"))
    val prk = mac.doFinal(ikm)

    // HKDF-Expand
    val result = ByteArray(length)
    var t = ByteArray(0)
    var offset = 0
    var counter: Byte = 1
    while (offset < length) {
      mac.init(SecretKeySpec(prk, "HmacSHA256"))
      mac.update(t)
      mac.update(BLOCKSTORE_HKDF_INFO)
      mac.update(counter)
      t = mac.doFinal()
      val toCopy = minOf(t.size, length - offset)
      System.arraycopy(t, 0, result, offset, toCopy)
      offset += toCopy
      counter++
    }
    return result
  }

  // --- Base58 encoding/decoding ---

  private fun base58Decode(input: String): ByteArray {
    var leadingOnes = 0
    for (c in input) {
      if (c == '1') leadingOnes++ else break
    }

    var num = java.math.BigInteger.ZERO
    for (c in input) {
      val digit = ALPHABET.indexOf(c)
      if (digit < 0) throw IllegalArgumentException("Invalid base58 character: $c")
      num = num.multiply(java.math.BigInteger.valueOf(58)).add(java.math.BigInteger.valueOf(digit.toLong()))
    }

    val bytes = num.toByteArray()
    // Remove leading zero byte added by BigInteger for sign
    val stripped = if (bytes.isNotEmpty() && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
    val result = ByteArray(leadingOnes) + stripped
    return result
  }

  // --- Base58 encoding ---

  private fun base58Encode(data: ByteArray): String {
    val sb = StringBuilder()
    var leadingZeros = 0
    for (b in data) {
      if (b.toInt() == 0) leadingZeros++ else break
    }

    var bytes = data.copyOf()
    while (bytes.isNotEmpty()) {
      var carry = 0
      val newBytes = mutableListOf<Byte>()
      for (b in bytes) {
        carry = carry * 256 + (b.toInt() and 0xFF)
        if (newBytes.isNotEmpty() || carry / 58 > 0) {
          newBytes.add((carry / 58).toByte())
        }
        carry %= 58
      }
      sb.append(ALPHABET[carry])
      bytes = newBytes.toByteArray()
    }

    for (i in 0 until leadingZeros) {
      sb.append('1')
    }

    return sb.reverse().toString()
  }
}
