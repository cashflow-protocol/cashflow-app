import { useCallback, useState } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import { executeAdminInstructionsWithGasCover } from '../services/squadsService';
import { logError } from '../services/analyticsService';
import { invalidateRewards } from './useRewards';

/**
 * Per-badge mint flow.
 *
 *   1. POST /rewards/v2/badge/mint { taskSlug } — backend returns serialized
 *      Metaplex Core updatePlugin instructions (admin = updateAuthority + fee payer).
 *   2. Mobile builds a single VersionedTransaction with
 *      [...updatePluginIxs, jitoTip, createCoverFromSquadInstruction], signs
 *      as the cover member, and submits via /solana/v2/send-bundle which
 *      co-signs as admin server-side.
 *   3. POST /rewards/v2/badge/mint/confirm — backend verifies the signature
 *      onchain and flips progress to MINTED.
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

      const result = await executeAdminInstructionsWithGasCover(
        vault.multisigAddress,
        built.updatePluginInstructions,
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
