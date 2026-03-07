import { Platform } from 'react-native';

/** Whether we're running on Solana Mobile (affects multisig threshold & signing flow).
 *  MWA is only available on Android — iOS always uses cloud+device signing only. */
export const IS_SOLANA_MOBILE = Platform.OS === 'android' && Platform.constants.Brand == 'solanamobile' && Platform.constants.Model == 'Seeker';
console.log('IS_SOLANA_MOBILE:', IS_SOLANA_MOBILE);

/** Lamports to keep in cloud wallet for vault tx fees + rent (~0.025 SOL) */
export const TARGET_CLOUD_BALANCE = 25_000_000;

export const VAULT_CREATION_FEE = 0; //TODO: set it to 50_000_000 = 0.05 SOL later

/** Minimum lamports required to create a new vault (0.03 SOL) */
export const MIN_LAMPORTS_FOR_VAULT = TARGET_CLOUD_BALANCE + VAULT_CREATION_FEE + 5_000_000;
