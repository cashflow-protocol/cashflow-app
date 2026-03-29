import { Platform } from 'react-native';

/** Whether we're running on Solana Mobile (affects multisig threshold & signing flow).
 *  MWA is only available on Android — iOS always uses cloud+device signing only. */
export const IS_SOLANA_MOBILE = Platform.OS === 'android' && Platform.constants.Brand == 'solanamobile' && Platform.constants.Model == 'Seeker';
console.log('IS_SOLANA_MOBILE:', IS_SOLANA_MOBILE);

// ── Remote-configurable values ──
// Defaults match the backend. applyRemoteConfig() overwrites them
// once GET /config/v1 returns.

let _targetCloudBalance = 25_000_000;   // 0.025 SOL
let _vaultCreationFee   = 50_000_000;   // 0.05 SOL

/** Call once at app startup with the backend config response. */
export function applyRemoteConfig(config: { targetCloudBalance?: number | null; vaultCreationFee?: number | null }) {
  if (config.targetCloudBalance != null) _targetCloudBalance = config.targetCloudBalance;
  if (config.vaultCreationFee != null) _vaultCreationFee = config.vaultCreationFee;
}

/** Lamports to keep in cloud wallet for vault tx fees + rent */
export function getTargetCloudBalance(): number { return _targetCloudBalance; }

/** Vault creation fee in lamports */
export function getVaultCreationFee(): number { return _vaultCreationFee; }

/** Minimum lamports required to create a new vault */
export function getMinLamportsForVault(): number {
  // Seeker: no cloud key funding needed — just creation fee + gas
  if (IS_SOLANA_MOBILE) return _vaultCreationFee + 5_000_000;
  return _targetCloudBalance + _vaultCreationFee + 5_000_000;
}
