import Foundation
import CryptoKit
import Security
import LocalAuthentication

/// Swift implementation of Ed25519 keypair generation, storage, and signing.
/// Uses CryptoKit for Ed25519 and Security framework for Keychain storage.
/// Closure types are used instead of RN-specific types so this file compiles
/// without needing a bridging header to React.
@objcMembers
class CashflowSigningImpl: NSObject {

  private let servicePrefix = "fun.cashflow.signing."
  private let aesKeyService = "fun.cashflow.signing.aeskey"

  // MARK: - Public API

  func generateKeypair(
    _ tag: String,
    cloudSync: Bool,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    do {
      let privateKey = Curve25519.Signing.PrivateKey()
      try storePrivateKey(privateKey.rawRepresentation, tag: tag, cloudSync: cloudSync, biometric: !cloudSync)
      let pubKeyBase58 = base58Encode(Data(privateKey.publicKey.rawRepresentation))
      resolve(pubKeyBase58)
    } catch {
      reject("ERR_KEYGEN", "Failed to generate keypair: \(error.localizedDescription)", error)
    }
  }

  func getPublicKey(
    _ tag: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    do {
      guard let keyData = try loadPrivateKey(tag: tag) else {
        resolve(nil)
        return
      }
      let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
      let pubKeyBase58 = base58Encode(Data(privateKey.publicKey.rawRepresentation))
      resolve(pubKeyBase58)
    } catch {
      reject("ERR_GET_KEY", "Failed to get public key: \(error.localizedDescription)", error)
    }
  }

  func sign(
    _ tag: String,
    messageBase64: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    do {
      guard let keyData = try loadPrivateKey(tag: tag) else {
        reject("ERR_NO_KEY", "No keypair found for tag: \(tag)", nil)
        return
      }
      guard let messageData = Data(base64Encoded: messageBase64) else {
        reject("ERR_INVALID_INPUT", "Invalid base64 message", nil)
        return
      }
      let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
      let signature = try privateKey.signature(for: messageData)
      resolve(signature.base64EncodedString())
    } catch {
      reject("ERR_SIGN", "Failed to sign: \(error.localizedDescription)", error)
    }
  }

  func hasKeypair(
    _ tag: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: false,
    ]
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    resolve(status == errSecSuccess)
  }

  func exportPrivateKey(
    _ tag: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    do {
      guard let keyData = try loadPrivateKey(tag: tag) else {
        resolve(nil)
        return
      }
      let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
      // Return 64-byte keypair (32 private + 32 public) as base58, matching Solana convention
      var fullKeypair = Data(privateKey.rawRepresentation)
      fullKeypair.append(privateKey.publicKey.rawRepresentation)
      resolve(base58Encode(fullKeypair))
    } catch {
      reject("ERR_EXPORT_KEY", "Failed to export private key: \(error.localizedDescription)", error)
    }
  }

  func deleteKeypair(
    _ tag: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    let status = SecItemDelete(query as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound {
      resolve(nil)
    } else {
      reject("ERR_DELETE", "Failed to delete keypair, status: \(status)", nil)
    }
  }

  // MARK: - Keychain helpers

  private func storePrivateKey(_ keyData: Data, tag: String, cloudSync: Bool, biometric: Bool = false) throws {
    // Only AES-encrypt device keys — cloud keys must remain readable on other devices
    // (the AES key is device-only and won't exist on a new device)
    let dataToStore = cloudSync ? keyData : try aesEncrypt(keyData)

    // Delete any existing key first (kSecAttrSynchronizableAny matches both synced and non-synced)
    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrAccount as String: tag,
      kSecValueData as String: dataToStore,
      kSecAttrSynchronizable as String: cloudSync ? kCFBooleanTrue! : kCFBooleanFalse!,
    ]

    if cloudSync {
      // iCloud-synced keys cannot use biometric access control (Apple limitation)
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
    } else if biometric {
      // Device-only key with biometric protection (passcode fallback via .userPresence)
      var error: Unmanaged<CFError>?
      guard let accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .userPresence,
        &error
      ) else {
        throw NSError(domain: "CashflowSigning", code: -1,
                      userInfo: [NSLocalizedDescriptionKey: "Failed to create access control: \(error?.takeRetainedValue().localizedDescription ?? "unknown")"])
      }
      query[kSecAttrAccessControl as String] = accessControl
    } else {
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }

    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "CashflowSigning", code: Int(status),
                    userInfo: [NSLocalizedDescriptionKey: "Keychain store failed: \(status)"])
    }
  }

  private func loadPrivateKey(tag: String) throws -> Data? {
    let context = LAContext()
    // Allow reuse of biometric auth for 30 seconds to avoid repeated prompts during multi-step transactions
    context.touchIDAuthenticationAllowableReuseDuration = 30

    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecUseAuthenticationContext as String: context,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess, let data = result as? Data else {
      throw NSError(domain: "CashflowSigning", code: Int(status),
                    userInfo: [NSLocalizedDescriptionKey: "Keychain read failed: \(status)"])
    }
    // Only device keys are AES-encrypted; cloud keys are stored raw (for iCloud sync compatibility)
    if tag == "cloud" {
      return data
    }
    return try aesDecrypt(data)
  }

  // MARK: - Biometric Authentication

  func authenticate(
    _ reason: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    let context = LAContext()
    context.localizedFallbackTitle = "Use Passcode"

    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
      // No biometrics or passcode available — allow access
      resolve(true)
      return
    }

    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, evalError in
      DispatchQueue.main.async {
        if success {
          resolve(true)
        } else {
          resolve(false)
        }
      }
    }
  }

  func migrateKeypairsToBiometric(
    _ resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    let migrationKey = "fun.cashflow.signing.biometricMigrated"
    if UserDefaults.standard.bool(forKey: migrationKey) {
      resolve(false)
      return
    }

    do {
      // Migrate both keys: device key gets AES encryption + biometric access control
      // Cloud key is re-stored as-is (no AES, keeps iCloud sync for cross-device recovery)

      for (tag, cloudSync) in [("device", false), ("cloud", true)] {
        let syncAttr: Any = cloudSync ? kSecAttrSynchronizableAny : (false as CFBoolean)
        let plainQuery: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrService as String: servicePrefix + tag,
          kSecAttrSynchronizable as String: syncAttr,
          kSecReturnData as String: true,
          kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(plainQuery as CFDictionary, &result)

        if status == errSecSuccess, let rawSeed = result as? Data {
          // Check if data is already AES-encrypted (AES-GCM combined is 12 nonce + data + 16 tag = 60 bytes for 32-byte seed)
          // Raw Ed25519 seed is exactly 32 bytes; encrypted is always > 32
          if rawSeed.count == 32 {
            // Re-store with AES encryption (+ biometric for device key)
            try storePrivateKey(rawSeed, tag: tag, cloudSync: cloudSync, biometric: !cloudSync)
          }
        }
      }

      UserDefaults.standard.set(true, forKey: migrationKey)
      resolve(true)
    } catch {
      reject("ERR_MIGRATE", "Failed to migrate keypairs: \(error.localizedDescription)", error)
    }
  }

  // MARK: - AES-256-GCM Envelope Encryption

  /// Hardcoded salt compiled into the binary — an attacker needs both the Keychain key AND
  /// this salt to derive the actual encryption key. Changing this invalidates all stored keys.
  private static let aesSalt = Data("cashflow:ios:v1:a4e1b8d3".utf8)

  /// Get or create a 256-bit base key stored in Keychain, then derive the actual encryption
  /// key via HKDF with the hardcoded salt.
  private func getDerivedAesKey() throws -> SymmetricKey {
    let baseKey = try getOrCreateBaseKey()
    // HKDF-SHA256: combine Keychain key + hardcoded salt → derived key
    return HKDF<SHA256>.deriveKey(
      inputKeyMaterial: baseKey,
      salt: CashflowSigningImpl.aesSalt,
      info: Data("aes-gcm-encryption".utf8),
      outputByteCount: 32
    )
  }

  /// Get or create the random 256-bit base key in Keychain (device-only, no sync).
  private func getOrCreateBaseKey() throws -> SymmetricKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: aesKeyService,
      kSecAttrAccount as String: "aes256",
      kSecAttrSynchronizable as String: false,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecSuccess, let keyData = result as? Data {
      return SymmetricKey(data: keyData)
    }

    // Generate a new random 256-bit key
    let newKey = SymmetricKey(size: .bits256)
    let keyData = newKey.withUnsafeBytes { Data($0) }

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: aesKeyService,
      kSecAttrAccount as String: "aes256",
      kSecValueData as String: keyData,
      kSecAttrSynchronizable as String: false,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]

    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw NSError(domain: "CashflowSigning", code: Int(addStatus),
                    userInfo: [NSLocalizedDescriptionKey: "Failed to store AES key: \(addStatus)"])
    }

    return newKey
  }

  /// Encrypt plaintext with AES-256-GCM using the derived key. Returns nonce + ciphertext + tag.
  private func aesEncrypt(_ plaintext: Data) throws -> Data {
    let key = try getDerivedAesKey()
    let sealedBox = try AES.GCM.seal(plaintext, using: key)
    guard let combined = sealedBox.combined else {
      throw NSError(domain: "CashflowSigning", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "AES-GCM seal failed"])
    }
    return combined
  }

  /// Decrypt AES-256-GCM data (nonce + ciphertext + tag) using the derived key.
  /// Falls back to returning raw data if it's a pre-migration unencrypted 32-byte seed.
  private func aesDecrypt(_ encrypted: Data) throws -> Data {
    // Raw Ed25519 seed is exactly 32 bytes; AES-GCM combined is always larger (12 nonce + ciphertext + 16 tag)
    if encrypted.count == 32 {
      return encrypted
    }
    let key = try getDerivedAesKey()
    let sealedBox = try AES.GCM.SealedBox(combined: encrypted)
    return try AES.GCM.open(sealedBox, using: key)
  }

  // MARK: - Base58

  private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

  private func base58Encode(_ data: Data) -> String {
    var bytes = [UInt8](data)
    var result = [Character]()

    // Count leading zeros
    var leadingZeros = 0
    for byte in bytes {
      if byte == 0 { leadingZeros += 1 } else { break }
    }

    // Convert to base58
    while !bytes.isEmpty {
      var carry = 0
      var newBytes = [UInt8]()
      for byte in bytes {
        carry = carry * 256 + Int(byte)
        if !newBytes.isEmpty || carry / 58 > 0 {
          newBytes.append(UInt8(carry / 58))
        }
        carry %= 58
      }
      result.append(CashflowSigningImpl.alphabet[carry])
      bytes = newBytes
    }

    // Add leading '1's for each leading zero byte
    for _ in 0..<leadingZeros {
      result.append("1")
    }

    return String(result.reversed())
  }
}
