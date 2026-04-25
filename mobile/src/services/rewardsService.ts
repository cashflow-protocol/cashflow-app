import { Buffer } from 'buffer';
import apiService from './apiService';
import walletService from './walletService';
import { getVault } from './vaultStorage';
import { IS_SOLANA_MOBILE } from '../config/constants';
import { logError } from './analyticsService';

let _attesting = false;

/**
 * If the user is on Seeker and hasn't attested yet, prompt MWA to sign a
 * server-issued challenge proving possession of the wallet.
 *
 * Returns true if the attestation completed (or was a no-op — wrong device or
 * already in progress); throws on failure so the caller can show feedback.
 * Idempotent within a single app session (won't double-prompt).
 */
export async function attestSeekerIfNeeded(): Promise<boolean> {
  if (!IS_SOLANA_MOBILE) return false;
  if (_attesting) return false;

  const vault = await getVault();
  if (!vault?.walletAddress) return false;

  _attesting = true;
  try {
    const { challenge } = await apiService.getSeekerAttestChallenge(vault.walletAddress);
    const messageBytes = new Uint8Array(Buffer.from(challenge, 'utf-8'));
    const signatures = await walletService.signMessages([messageBytes], vault.walletAddress);
    if (!signatures.length) throw new Error('MWA returned no signature');
    const signatureBase64 = Buffer.from(signatures[0]).toString('base64');
    await apiService.attestSeeker({
      walletAddress: vault.walletAddress,
      challenge,
      signature: signatureBase64,
    });
    return true;
  } catch (err: any) {
    logError('seeker_attest', err?.message ?? 'unknown');
    throw err;
  } finally {
    _attesting = false;
  }
}
