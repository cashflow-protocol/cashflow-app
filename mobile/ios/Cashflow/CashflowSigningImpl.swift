import Foundation
import CryptoKit
import Security

/// Swift implementation of Ed25519 keypair generation, storage, and signing.
/// Uses CryptoKit for Ed25519 and Security framework for Keychain storage.
/// Closure types are used instead of RN-specific types so this file compiles
/// without needing a bridging header to React.
@objcMembers
class CashflowSigningImpl: NSObject {

  private let servicePrefix = "fun.cashflow.signing."

  // MARK: - Public API

  func generateKeypair(
    _ tag: String,
    cloudSync: Bool,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, (any Error)?) -> Void
  ) {
    do {
      let privateKey = Curve25519.Signing.PrivateKey()
      try storePrivateKey(privateKey.rawRepresentation, tag: tag, cloudSync: cloudSync)
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

  private func storePrivateKey(_ keyData: Data, tag: String, cloudSync: Bool) throws {
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
      kSecValueData as String: keyData,
      kSecAttrSynchronizable as String: cloudSync ? kCFBooleanTrue! : kCFBooleanFalse!,
    ]

    if cloudSync {
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
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
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: servicePrefix + tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
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
    return data
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
