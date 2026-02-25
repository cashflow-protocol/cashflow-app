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
