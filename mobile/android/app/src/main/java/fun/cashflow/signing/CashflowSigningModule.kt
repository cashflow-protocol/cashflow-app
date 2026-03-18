package `fun`.cashflow.signing

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
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
    private const val PREFS_NAME = "fun.cashflow.signing"
    private const val GCM_TAG_LENGTH = 128
    private const val BIO_VALIDITY_SECONDS = 30
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    // Hardcoded salt compiled into the binary — an attacker needs both the Keystore key AND
    // this salt to recover the seed. Must match iOS. Changing this invalidates all stored keys.
    private val AES_SALT = "cashflow:android:v1:9c5f2d7b".toByteArray(Charsets.UTF_8)
    private val HKDF_INFO = "aes-gcm-encryption".toByteArray(Charsets.UTF_8)
  }

  override fun getName(): String = NAME

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
        // Ensure the biometric Keystore key exists before prompting
        getOrCreateAesKey(biometric = true)

        // Try encrypting — may throw UserNotAuthenticatedException
        try {
          val encrypted = encryptWithKeystore(seed, biometric = true)
          saveAndResolve(tag, seed, pubKey, encrypted, useBio = true, promise)
        } catch (e: UserNotAuthenticatedException) {
          // Prompt biometric, then retry encryption
          promptBiometricThenEncrypt(tag, seed, pubKey, promise)
        }
      } else {
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

  private fun promptBiometricThenEncrypt(
    tag: String,
    seed: ByteArray,
    pubKey: ByteArray,
    promise: Promise,
  ) {
    promptBiometricUnlock("Authenticate to secure your signing key") { success, error ->
      if (!success) {
        seed.fill(0)
        promise.reject("ERR_KEYGEN", "Failed to generate keypair: ${error?.message ?: "authentication required"}", error)
        return@promptBiometricUnlock
      }
      try {
        val encrypted = encryptWithKeystore(seed, biometric = true)
        saveAndResolve(tag, seed, pubKey, encrypted, useBio = true, promise)
      } catch (e: Exception) {
        seed.fill(0)
        promise.reject("ERR_KEYGEN", "Failed to generate keypair: ${e.message}", e)
      }
    }
  }

  /** Prompt biometric just to unlock the Keystore key (no decrypt needed). */
  private fun promptBiometricUnlock(reason: String, onResult: (Boolean, Exception?) -> Unit) {
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
        onResult(false, Exception("Authentication cancelled: $errString"))
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
        decryptWithBiometric(encrypted, "Authenticate to export key") { seed, error ->
          if (error != null) {
            promise.reject("ERR_EXPORT", "Failed to export private key: ${error.message}", error)
            return@decryptWithBiometric
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
        val seed = decryptWithKeystore(encrypted, biometric = false)
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

  @ReactMethod
  override fun sign(tag: String, messageBase64: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("${tag}_seed", null)
        ?: throw Exception("No keypair found for tag: $tag")
      val useBio = prefs.getBoolean("${tag}_bio", false)
      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)

      if (useBio) {
        decryptWithBiometric(encrypted, "Authenticate to sign") { seed, error ->
          if (error != null) {
            promise.reject("ERR_SIGN", "Failed to sign: ${error.message}", error)
            return@decryptWithBiometric
          }
          try {
            val message = Base64.decode(messageBase64, Base64.NO_WRAP)
            val privateKey = Ed25519PrivateKeyParameters(seed!!, 0)
            val signer = Ed25519Signer()
            signer.init(true, privateKey)
            signer.update(message, 0, message.size)
            val signature = signer.generateSignature()
            promise.resolve(Base64.encodeToString(signature, Base64.NO_WRAP))
          } finally {
            seed!!.fill(0)
          }
        }
      } else {
        val seed = decryptWithKeystore(encrypted, biometric = false)
        try {
          val message = Base64.decode(messageBase64, Base64.NO_WRAP)
          val privateKey = Ed25519PrivateKeyParameters(seed, 0)
          val signer = Ed25519Signer()
          signer.init(true, privateKey)
          signer.update(message, 0, message.size)
          val signature = signer.generateSignature()
          promise.resolve(Base64.encodeToString(signature, Base64.NO_WRAP))
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

  private fun decryptWithBiometric(
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
      builder.setUserAuthenticationValidityDurationSeconds(BIO_VALIDITY_SECONDS)
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

  private fun getPrefs(): SharedPreferences {
    return reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
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
