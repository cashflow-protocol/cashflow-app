import { Router, Request, Response } from 'express';
import { createSolanaRpc, address } from '@solana/kit';
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { JupiterManager, KaminoManager } from '../managers';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { EarnTokenType } from '../types';
import type { Suggestion, SuggestionsRequest } from '../types';

const router = Router();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();

// Minimum SOL balance (in lamports) below which we suggest funding
const LOW_SOL_THRESHOLD = 50_000_000n; // 0.05 SOL

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      vaultAddress,
      walletAddress,
      appVersion,
      buildNumber,
      androidVersion,
      device,
      platform,
    } = req.body as SuggestionsRequest;

    const suggestions: Suggestion[] = [];

    // --- Link suggestions (hardcoded for now) ---
    // Example: uncomment to add announcements
    // suggestions.push({
    //   id: 'link-telegram',
    //   type: 'link',
    //   title: 'Join our community',
    //   description: 'Get the latest updates and connect with other users on Telegram.',
    //   buttonTitle: 'Open Telegram',
    //   url: 'https://t.me/cashflow_app',
    // });

    const targetAddress = vaultAddress || walletAddress;

    // --- Fund wallet suggestion ---
    if (targetAddress) {
      try {
        const balanceResult = await rpc.getBalance(address(targetAddress)).send();
        if (balanceResult.value < LOW_SOL_THRESHOLD) {
          suggestions.push({
            id: 'fund-wallet',
            type: 'fund_wallet_from_seeker',
            title: 'Fund your wallet',
            description: 'Your vault SOL balance is low. Transfer SOL from your Solana wallet to cover transaction fees.',
            buttonTitle: 'Receive SOL',
          });
        }
      } catch (err) {
        console.error('Error checking SOL balance for suggestions:', err);
      }
    }

    // --- Transfer position suggestions ---
    if (targetAddress) {
      try {
        const kaminoPositions = await kaminoManager.getWalletPositions(targetAddress);

        for (const pos of kaminoPositions) {
          const mint = (pos as any).mint;
          const tokenInfo = mint ? SUPPORTED_TOKENS_BY_MINT[mint] : undefined;
          const symbol = tokenInfo?.symbol ?? '';
          const uiAmount = Number((pos as any).amount ?? 0) / 10 ** (tokenInfo?.decimals ?? 0);

          if (uiAmount > 0 && (symbol === 'USDC' || symbol === 'USDS')) {
            suggestions.push({
              id: `transfer-kamino-${symbol}-to-jupiter`,
              type: 'transfer_position',
              title: `Move ${symbol} to Jupiter`,
              description: `You have ${uiAmount.toFixed(2)} ${symbol} earning on Kamino. Jupiter Lend currently offers higher rates for similar assets.`,
              buttonTitle: 'View Earn',
              transferPosition: {
                from: { protocol: EarnTokenType.KAMINO, mint, symbol, apy: 0 },
                to: { protocol: EarnTokenType.JUPITER, mint: '', symbol: 'JupSOL', apy: 0 },
              },
            });
          }
        }
      } catch (err) {
        console.error('Error checking positions for suggestions:', err);
      }
    }

    res.json({
      success: true,
      data: suggestions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
