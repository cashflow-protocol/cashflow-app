import { Buffer } from 'buffer';
import apiService from './apiService';
import walletService from './walletService';
import { getVault } from './vaultStorage';
import { IS_SOLANA_MOBILE } from '../config/constants';
import { logError } from './analyticsService';

let _attesting = false;

/**
 * If the user is on Seeker and hasn't attested yet, prompt MWA to sign a
 * server-issued challenge proving possession of the wallet. No-op otherwise.
 *
 * Idempotent within a single app session (won't double-prompt).
 * Best-effort — failures are logged but don't propagate.
 */
export async function attestSeekerIfNeeded(): Promise<void> {
  if (!IS_SOLANA_MOBILE) return;
  if (_attesting) return;

  const vault = await getVault();
  if (!vault?.walletAddress) return;

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
  } catch (err: any) {
    logError('seeker_attest', err?.message ?? 'unknown');
  } finally {
    _attesting = false;
  }
}
