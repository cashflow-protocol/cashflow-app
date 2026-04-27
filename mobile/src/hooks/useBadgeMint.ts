import { useCallback, useState } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';
import { logError } from '../services/analyticsService';
import { invalidateRewards } from './useRewards';

/**
 * Per-badge mint flow.
 *
 *   1. POST /rewards/v2/badge/mint { taskSlug } — backend builds inner
 *      instructions (gas reimbursement vault → admin) plus an admin-pre-signed
 *      Metaplex Core updatePlugin TX that appends the badge attribute.
 *   2. Mobile bundles them via executeVaultTransaction (TX1-TX4 + TX5).
 *   3. POST /rewards/v2/badge/mint/confirm — backend verifies bundle
 *      signatures onchain and flips progress to MINTED.
 *   4. invalidateRewards() so the UI shows the minted state.
 */
export function useBadgeMint() {
  const [mintingSlug, setMintingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mint = useCallback(async (taskSlug: string): Promise<void> => {
    setMintingSlug(taskSlug);
    setError(null);
    try {
      const vault = await getVault();
      if (!vault?.multisigAddress) throw new Error('No vault found');

      const built = await apiService.mintBadge(taskSlug);

      const result = await executeVaultTransaction(
        vault.multisigAddress,
        built.innerInstructions,
        undefined,
        undefined,
        [built.mintTransactionBase64],
      );

      await apiService
        .confirmBadgeMint(built.badgeMintId, result.bundleSignatures)
        .catch(() => undefined);

      invalidateRewards();
    } catch (err: any) {
      logError('badge_mint', err?.message ?? 'unknown');
      setError(err?.message ?? 'Mint failed');
      throw err;
    } finally {
      setMintingSlug(null);
    }
  }, []);

  return { mint, mintingSlug, error };
}
