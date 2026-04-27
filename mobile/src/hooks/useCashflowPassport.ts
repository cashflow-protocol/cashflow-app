import { useCallback, useState } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';
import { logError } from '../services/analyticsService';
import { invalidateRewards } from './useRewards';

/**
 * Activation flow for the user's one-time Cashflow Passport asset.
 *
 *   1. POST /rewards/v2/cashflow-passport/activate — backend builds inner
 *      instructions (fee transfer vault → treasury) plus an admin-pre-signed
 *      Metaplex Core mint TX.
 *   2. Mobile bundles them via executeVaultTransaction (TX1-TX4 + TX5).
 *   3. POST /rewards/v2/cashflow-passport/activate/confirm — backend verifies
 *      bundle signatures onchain and writes User.cashflowPassportAddress,
 *      then kicks off auto-add for any already-claimable badges.
 *   4. invalidateRewards() so the UI shows the activated state and any
 *      newly-minted attributes.
 */
export function useCashflowPassportActivation() {
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = useCallback(async (): Promise<{ assetAddress: string }> => {
    setActivating(true);
    setError(null);
    try {
      const vault = await getVault();
      if (!vault?.multisigAddress) throw new Error('No vault found');

      const built = await apiService.activateCashflowPassport();

      const result = await executeVaultTransaction(
        vault.multisigAddress,
        built.innerInstructions,
        undefined,
        undefined,
        [built.mintTransactionBase64],
      );

      // Sync verify on backend; recovery cron is the failsafe.
      await apiService
        .confirmCashflowPassportActivation(built.activationId, result.bundleSignatures)
        .catch(() => undefined);

      invalidateRewards();
      return { assetAddress: built.assetAddress };
    } catch (err: any) {
      logError('cashflow_passport_activate', err?.message ?? 'unknown');
      setError(err?.message ?? 'Activation failed');
      throw err;
    } finally {
      setActivating(false);
    }
  }, []);

  return { activate, activating, error };
}
