/**
 * Secure keypair management via native TurboModule.
 *
 * Private keys are generated, stored, and used for signing entirely in native
 * code — they never enter the JS heap.
 *
 * Two keypairs are managed for Squad multisig signing:
 * - cloud: synced to iCloud Keychain (iOS) for cross-device recovery
 * - device: stored locally only, never backed up
 */

import NativeCashflowSigning from '../specs/NativeCashflowSigning';

function getModule() {
  if (!NativeCashflowSigning) {
    throw new Error(
      'CashflowSigning native module not found. Did you rebuild the native app?',
    );
  }
  return NativeCashflowSigning;
}

/**
 * Generate a new cloud keypair (syncs to iCloud on iOS).
 * Returns the base58-encoded public key.
 */
export async function generateAndStoreCloudKeypair(): Promise<string> {
  return getModule().generateKeypair('cloud', true);
}

/**
 * Generate a new device keypair (device-only, no backup).
 * Returns the base58-encoded public key.
 */
export async function generateAndStoreDeviceKeypair(): Promise<string> {
  return getModule().generateKeypair('device', false);
}

/**
 * Get the base58 public key for the cloud keypair, or null if not generated.
 */
export async function getCloudPublicKey(): Promise<string | null> {
  if (!NativeCashflowSigning) return null;
  return NativeCashflowSigning.getPublicKey('cloud');
}

/**
 * Get the base58 public key for the device keypair, or null if not generated.
 */
export async function getDevicePublicKey(): Promise<string | null> {
  if (!NativeCashflowSigning) return null;
  return NativeCashflowSigning.getPublicKey('device');
}

/**
 * Export the cloud keypair as base58 (64-byte: 32 private + 32 public).
 * Returns null if not generated.
 */
export async function getCloudPrivateKey(): Promise<string | null> {
  if (!NativeCashflowSigning) return null;
  return NativeCashflowSigning.exportPrivateKey('cloud');
}

/**
 * Export the device keypair as base58 (64-byte: 32 private + 32 public).
 * Returns null if not generated.
 */
export async function getDevicePrivateKey(): Promise<string | null> {
  if (!NativeCashflowSigning) return null;
  return NativeCashflowSigning.exportPrivateKey('device');
}

/**
 * Sign a message with the cloud keypair. Message and signature are base64.
 */
export async function signWithCloud(messageBase64: string): Promise<string> {
  return getModule().sign('cloud', messageBase64);
}

/**
 * Sign a message with the device keypair. Message and signature are base64.
 */
export async function signWithDevice(messageBase64: string): Promise<string> {
  return getModule().sign('device', messageBase64);
}

/**
 * Check if both cloud and device keypairs exist.
 * Used to determine if a Squad has already been created.
 */
export async function hasKeypairs(): Promise<boolean> {
  if (!NativeCashflowSigning) return false;
  const [cloud, device] = await Promise.all([
    NativeCashflowSigning.hasKeypair('cloud'),
    NativeCashflowSigning.hasKeypair('device'),
  ]);
  return cloud && device;
}

/**
 * Delete both cloud and device keypairs from native storage.
 */
export async function deleteAllKeypairs(): Promise<void> {
  const mod = getModule();
  await Promise.all([
    mod.deleteKeypair('cloud'),
    mod.deleteKeypair('device'),
  ]);
}

/**
 * Prompt the user for biometric authentication (Face ID / Touch ID / passcode).
 * Returns true if authenticated, false if cancelled or failed.
 */
export async function authenticate(reason: string): Promise<boolean> {
  return getModule().authenticate(reason);
}

/**
 * One-time migration: re-store existing device keys with biometric access control.
 * Safe to call multiple times — skips if already migrated.
 * Returns true if migration was performed, false if already done or no keys exist.
 */
export async function migrateKeypairsToBiometric(): Promise<boolean> {
  return getModule().migrateKeypairsToBiometric();
}

/**
 * Cache the PIN in native memory for cloud key encryption/decryption.
 * Call after PIN entry (unlock or setup). The PIN is held in memory only.
 */
export async function cachePin(pin: string): Promise<void> {
  return getModule().cachePin(pin);
}

/**
 * Clear the cached PIN from native memory. Call when app locks.
 */
export async function clearCachedPin(): Promise<void> {
  return getModule().clearCachedPin();
}

/**
 * Store the PIN encrypted with biometric-protected Keystore key.
 * Call after PIN entry so future biometric unlocks can retrieve it.
 */
export async function storePinForBiometric(pin: string): Promise<void> {
  return getModule().storePinForBiometric(pin);
}

/**
 * Retrieve and cache the PIN using biometric authentication.
 * Returns the PIN on success, or null if no stored PIN or auth failed.
 */
export async function retrievePinWithBiometric(): Promise<string | null> {
  return getModule().retrievePinWithBiometric();
}

/**
 * Re-encrypt the cloud key with a new PIN (SharedPreferences + Block Store).
 * Uses the currently cached PIN to decrypt, then re-encrypts with newPin.
 */
export async function reEncryptCloudKeyWithPin(newPin: string): Promise<void> {
  return getModule().reEncryptCloudKeyWithPin(newPin);
}

/**
 * Back up the cloud key to Google Block Store, encrypted with PIN.
 * Android only — no-ops silently on iOS.
 */
export async function backupCloudKeyToBlockStore(pin: string): Promise<void> {
  return getModule().backupCloudKeyToBlockStore(pin);
}

/**
 * Restore the cloud key from Google Block Store using PIN.
 * Returns the base58 public key on success.
 * Throws ERR_WRONG_PIN if PIN is incorrect, ERR_NO_BACKUP if no backup exists.
 */
export async function restoreCloudKeyFromBlockStore(pin: string): Promise<string> {
  return getModule().restoreCloudKeyFromBlockStore(pin);
}

/**
 * Check if a cloud key backup exists in Google Block Store.
 */
export async function hasBlockStoreBackup(): Promise<boolean> {
  if (!NativeCashflowSigning) return false;
  return NativeCashflowSigning.hasBlockStoreBackup();
}
