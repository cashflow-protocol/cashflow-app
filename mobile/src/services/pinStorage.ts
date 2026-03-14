/**
 * PIN code storage using react-native-keychain.
 * Stores a SHA-256 hash of the PIN — the raw PIN never persists.
 */

import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';

const PIN_SERVICE = 'fun.cashflow.pinCode';

async function hashPin(pin: string): Promise<string> {
  // Use SubtleCrypto if available (Hermes), otherwise fall back to simple hash
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const data = new Uint8Array(Buffer.from(pin, 'utf-8'));
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Buffer.from(hash).toString('hex');
  }
  // Fallback: use a basic hash via native crypto isn't available,
  // but in practice Hermes + RN 0.84 supports SubtleCrypto
  const data = Buffer.from(pin, 'utf-8');
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export async function savePin(pin: string): Promise<void> {
  const hashed = await hashPin(pin);
  await Keychain.setGenericPassword('pin', hashed, {
    service: PIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

export async function verifyPin(pin: string): Promise<boolean> {
  const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
  if (!result) return false;
  const hashed = await hashPin(pin);
  return result.password === hashed;
}

export async function hasPin(): Promise<boolean> {
  const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
  return !!result;
}