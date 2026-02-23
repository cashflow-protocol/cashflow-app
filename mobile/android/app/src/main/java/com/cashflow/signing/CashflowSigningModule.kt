package fun.cashflow.signing

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
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
    private const val PREFS_NAME = "fun.cashflow.signing"
    private const val GCM_TAG_LENGTH = 128
    // Base58 alphabet
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  }

  override fun getName(): String = NAME

  @ReactMethod
  override fun generateKeypair(tag: String, cloudSync: Boolean, promise: Promise) {
    try {
      // Generate Ed25519 keypair via BouncyCastle
      val keyPairGenerator = Ed25519KeyPairGenerator()
      keyPairGenerator.init(Ed25519KeyGenerationParameters(java.security.SecureRandom()))
      val keyPair = keyPairGenerator.generateKeyPair()

      val privateKeyParams = keyPair.private as Ed25519PrivateKeyParameters
      val publicKeyParams = keyPair.public as Ed25519PublicKeyParameters

      val seed = privateKeyParams.encoded // 32 bytes
      val pubKey = publicKeyParams.encoded // 32 bytes

      // Encrypt seed with AES-GCM from Android Keystore
      val encrypted = encryptWithKeystore(seed)

      // Store encrypted seed + plaintext public key
      val prefs = getPrefs()
      prefs.edit()
        .putString("${tag}_seed", Base64.encodeToString(encrypted, Base64.NO_WRAP))
        .putString("${tag}_pub", Base64.encodeToString(pubKey, Base64.NO_WRAP))
        .apply()

      // Wipe seed from memory
      seed.fill(0)

      promise.resolve(base58Encode(pubKey))
    } catch (e: Exception) {
      promise.reject("ERR_KEYGEN", "Failed to generate keypair: ${e.message}", e)
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
  override fun sign(tag: String, messageBase64: String, promise: Promise) {
    try {
      val prefs = getPrefs()
      val encryptedBase64 = prefs.getString("${tag}_seed", null)
        ?: throw Exception("No keypair found for tag: $tag")

      val encrypted = Base64.decode(encryptedBase64, Base64.NO_WRAP)
      val seed = decryptWithKeystore(encrypted)

      try {
        val message = Base64.decode(messageBase64, Base64.NO_WRAP)

        // Reconstruct private key and sign
        val privateKey = Ed25519PrivateKeyParameters(seed, 0)
        val signer = Ed25519Signer()
        signer.init(true, privateKey)
        signer.update(message, 0, message.size)
        val signature = signer.generateSignature()

        promise.resolve(Base64.encodeToString(signature, Base64.NO_WRAP))
      } finally {
        // Wipe seed from memory
        seed.fill(0)
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
        .apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERR_DELETE", "Failed to delete keypair: ${e.message}", e)
    }
  }

  // --- AES-GCM Envelope Encryption via Android Keystore ---

  private fun getOrCreateAesKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)

    val existingKey = keyStore.getEntry(KEYSTORE_ALIAS, null)
    if (existingKey is KeyStore.SecretKeyEntry) {
      return existingKey.secretKey
    }

    val keyGenerator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
    )
    keyGenerator.init(
      KeyGenParameterSpec.Builder(
        KEYSTORE_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return keyGenerator.generateKey()
  }

  private fun encryptWithKeystore(plaintext: ByteArray): ByteArray {
    val key = getOrCreateAesKey()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv // 12 bytes generated by Android
    val ciphertext = cipher.doFinal(plaintext)
    // Prepend IV to ciphertext: [12-byte IV][ciphertext+tag]
    return iv + ciphertext
  }

  private fun decryptWithKeystore(data: ByteArray): ByteArray {
    val key = getOrCreateAesKey()
    val iv = data.copyOfRange(0, 12)
    val ciphertext = data.copyOfRange(12, data.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
    return cipher.doFinal(ciphertext)
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

    // Work on a copy as BigInteger-style division
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
