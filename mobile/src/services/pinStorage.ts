/**
 * PIN code storage using react-native-keychain.
 * Stores a SHA-256 hash of the PIN — the raw PIN never persists.
 * Includes brute-force protection with exponential backoff and lockout.
 */

import * as Keychain from 'react-native-keychain';
import { Buffer } from 'buffer';

const PIN_SERVICE = 'fun.cashflow.pinCode';
const ATTEMPTS_SERVICE = 'fun.cashflow.pinAttempts';
const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000; // 1 second

async function hashPin(pin: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('SubtleCrypto not available — cannot securely hash PIN');
  }
  const data = new Uint8Array(Buffer.from(pin, 'utf-8'));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hash).toString('hex');
}

/** Get the current failed attempt count and lockout timestamp. */
async function getAttemptState(): Promise<{ count: number; lockedUntil: number }> {
  const result = await Keychain.getGenericPassword({ service: ATTEMPTS_SERVICE });
  if (!result) return { count: 0, lockedUntil: 0 };
  try {
    return JSON.parse(result.password);
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

async function setAttemptState(count: number, lockedUntil: number): Promise<void> {
  await Keychain.setGenericPassword('attempts', JSON.stringify({ count, lockedUntil }), {
    service: ATTEMPTS_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

async function resetAttempts(): Promise<void> {
  await setAttemptState(0, 0);
}

export async function savePin(pin: string): Promise<void> {
  const hashed = await hashPin(pin);
  await Keychain.setGenericPassword('pin', hashed, {
    service: PIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
  await resetAttempts();
}

export async function verifyPin(pin: string): Promise<{ success: boolean; attemptsRemaining?: number; lockedUntilMs?: number }> {
  const state = await getAttemptState();

  // Check if currently locked out
  if (state.lockedUntil > Date.now()) {
    return { success: false, attemptsRemaining: MAX_ATTEMPTS - state.count, lockedUntilMs: state.lockedUntil };
  }

  const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
  if (!result) return { success: false };

  const hashed = await hashPin(pin);
  if (result.password === hashed) {
    // Correct PIN — reset attempts
    await resetAttempts();
    return { success: true };
  }

  // Wrong PIN — increment attempts and calculate backoff
  const newCount = state.count + 1;
  const remaining = MAX_ATTEMPTS - newCount;

  if (remaining <= 0) {
    // Locked out — 5 minute lockout after max attempts
    const lockedUntil = Date.now() + 5 * 60 * 1000;
    await setAttemptState(newCount, lockedUntil);
    return { success: false, attemptsRemaining: 0, lockedUntilMs: lockedUntil };
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ...
  const delay = BASE_DELAY_MS * Math.pow(2, newCount - 1);
  const lockedUntil = Date.now() + delay;
  await setAttemptState(newCount, lockedUntil);

  return { success: false, attemptsRemaining: remaining, lockedUntilMs: lockedUntil };
}

export async function hasPin(): Promise<boolean> {
  const result = await Keychain.getGenericPassword({ service: PIN_SERVICE });
  return !!result;
}