/**
 * Secure keypair storage using react-native-keychain.
 *
 * Two keypairs are stored for Squad multisig signing:
 * - cloudKeypair: synced to iCloud Keychain (iOS) for cross-device recovery
 * - deviceKeypair: stored locally only, never backed up
 */

import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';

const CLOUD_SERVICE = 'com.cashflow.squad.cloudKey';
const DEVICE_SERVICE = 'com.cashflow.squad.deviceKey';

/**
 * Save the cloud keypair (syncs to iCloud Keychain on iOS).
 * @param keypairBytes 64-byte array: 32-byte seed + 32-byte public key
 */
export async function saveCloudKeypair(keypairBytes: Uint8Array): Promise<void> {
  const encoded = Buffer.from(keypairBytes).toString('base64');
  await Keychain.setGenericPassword('cloudKey', encoded, {
    service: CLOUD_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    cloudSync: true,
  });
}

/**
 * Save the device keypair (device-only, no backup, no iCloud sync).
 * @param keypairBytes 64-byte array: 32-byte seed + 32-byte public key
 */
export async function saveDeviceKeypair(keypairBytes: Uint8Array): Promise<void> {
  const encoded = Buffer.from(keypairBytes).toString('base64');
  await Keychain.setGenericPassword('deviceKey', encoded, {
    service: DEVICE_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    cloudSync: false,
  });
}

/**
 * Retrieve the cloud keypair from keychain.
 * Returns 64-byte Uint8Array or null if not found.
 */
export async function getCloudKeypair(): Promise<Uint8Array | null> {
  const result = await Keychain.getGenericPassword({ service: CLOUD_SERVICE });
  if (!result) return null;
  return new Uint8Array(Buffer.from(result.password, 'base64'));
}

/**
 * Retrieve the device keypair from keychain.
 * Returns 64-byte Uint8Array or null if not found.
 */
export async function getDeviceKeypair(): Promise<Uint8Array | null> {
  const result = await Keychain.getGenericPassword({ service: DEVICE_SERVICE });
  if (!result) return null;
  return new Uint8Array(Buffer.from(result.password, 'base64'));
}

/**
 * Check if both keypairs exist in keychain.
 * Used to determine if a Squad has already been created.
 */
export async function hasKeypairs(): Promise<boolean> {
  const [cloud, device] = await Promise.all([
    Keychain.getGenericPassword({ service: CLOUD_SERVICE }),
    Keychain.getGenericPassword({ service: DEVICE_SERVICE }),
  ]);
  return !!cloud && !!device;
}
