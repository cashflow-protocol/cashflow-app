import { Platform } from 'react-native';

/** Whether we're running on Solana Mobile (affects multisig threshold & signing flow).
 *  MWA is only available on Android — iOS always uses cloud+device signing only. */
export const IS_SOLANA_MOBILE = Platform.OS === 'android' && Platform.constants.Brand == 'solanamobile' && Platform.constants.Model == 'Seeker';
console.log('IS_SOLANA_MOBILE:', IS_SOLANA_MOBILE);

// ── Remote-configurable values ──
// Defaults match the backend. applyRemoteConfig() overwrites them
// once GET /config/v1 returns.

let _vaultCreationFee   = 50_000_000;   // 0.05 SOL
let _adminTxFeePayerPublicKey: string | null = null;

/** Target balance for admin tx fee payer after cover (0.05 SOL) */
export const ADMIN_COVER_TARGET = 50_000_000;

/** SOL reserve held back when user taps MAX on send (0.01 SOL) */
export const SEND_MAX_RESERVE = 10_000_000;

/** Call once at app startup with the backend config response. */
export function applyRemoteConfig(config: { vaultCreationFee?: number | null; adminTxFeePayerPublicKey?: string | null }) {
  if (config.vaultCreationFee != null) _vaultCreationFee = config.vaultCreationFee;
  if (config.adminTxFeePayerPublicKey != null) _adminTxFeePayerPublicKey = config.adminTxFeePayerPublicKey;
}

/** Vault creation fee in lamports */
export function getVaultCreationFee(): number { return _vaultCreationFee; }

/** Admin tx fee payer public key (base58) */
export function getAdminTxFeePayerPublicKey(): string {
  if (!_adminTxFeePayerPublicKey) throw new Error('adminTxFeePayerPublicKey not configured — call applyRemoteConfig first');
  return _adminTxFeePayerPublicKey;
}

/** Minimum lamports required to create a new vault */
export function getMinLamportsForVault(): number {
  // Admin pays tx fees — user only needs creation fee + small buffer for gas
  return _vaultCreationFee + 5_000_000;
}
