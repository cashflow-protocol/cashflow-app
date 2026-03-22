/**
 * Persistent vault storage using react-native-keychain.
 * Stores vault metadata as JSON in the keychain alongside the keypairs.
 * Uses an in-memory cache to avoid repeated keychain reads.
 */

import * as Keychain from 'react-native-keychain';

const VAULT_SERVICE = 'fun.cashflow.vaultData';

export interface VaultData {
  multisigAddress: string;
  vaultAddress: string;
  label: string;
  createdAt: string;
  walletAddress?: string;
}

let cachedVault: VaultData | null | undefined = undefined; // undefined = not yet loaded

export async function saveVault(data: VaultData): Promise<void> {
  cachedVault = data;
  await Keychain.setGenericPassword('vault', JSON.stringify(data), {
    service: VAULT_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

export async function getVault(): Promise<VaultData | null> {
  if (cachedVault !== undefined) return cachedVault;

  const result = await Keychain.getGenericPassword({ service: VAULT_SERVICE });
  if (result) {
    cachedVault = JSON.parse(result.password) as VaultData;
  } else {
    cachedVault = null;
  }
  return cachedVault;
}

export async function clearVault(): Promise<void> {
  cachedVault = null;
  await Keychain.resetGenericPassword({ service: VAULT_SERVICE });
}


// Recovery email map: address → email
const RECOVERY_EMAILS_SERVICE = 'fun.cashflow.recoveryEmails';
let cachedRecoveryEmails: Record<string, string> | undefined = undefined;

export async function getRecoveryEmails(): Promise<Record<string, string>> {
  if (cachedRecoveryEmails !== undefined) return cachedRecoveryEmails;
  const result = await Keychain.getGenericPassword({ service: RECOVERY_EMAILS_SERVICE });
  cachedRecoveryEmails = result ? JSON.parse(result.password) : {};
  return cachedRecoveryEmails!;
}

export async function saveRecoveryEmail(address: string, email: string): Promise<void> {
  const map = await getRecoveryEmails();
  map[address] = email;
  cachedRecoveryEmails = map;
  await Keychain.setGenericPassword('recoveryEmails', JSON.stringify(map), {
    service: RECOVERY_EMAILS_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}
