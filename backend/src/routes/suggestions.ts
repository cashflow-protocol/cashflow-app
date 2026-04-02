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

// Latest app version – bump when a new release is published
const LATEST_APP_VERSION = '0.0';

/** Returns true if a < b using numeric segment comparison (e.g. "1.3" < "1.11") */
function isVersionOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}

// Minimum SOL balance (in lamports) below which we suggest funding
const LOW_SOL_THRESHOLD = 50_000_000n; // 0.05 SOL
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LOW_USDC_THRESHOLD = 1_000_000n; // 1 USDC (6 decimals)

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      vaultAddress,
      walletAddress,
      threshold,
      memberCount,
      appVersion,
      buildNumber,
      osVersion,
      device,
      platform,
    } = req.body as SuggestionsRequest;

    const suggestions: Suggestion[] = [];

    // INFO ABOUT MY DEVICE
    // suggestions.push({
    //   id: 'test',
    //   type: 'link',
    //   title: 'Info',
    //   description: `vaultAddress: ${vaultAddress}\nwallet: ${walletAddress}\napp version: ${appVersion}\nbuildNumber: ${buildNumber}\nplatform: ${platform}\nosVersion: ${osVersion}\ndevice: ${device}`,
    //   color: '#ff0',
    // });

    // --- Fund wallet suggestion ---
    if (vaultAddress) {
      try {
        const [solBalanceResult, usdcAccountsResult] = await Promise.all([
          rpc.getBalance(address(vaultAddress)).send(),
          rpc.getTokenAccountsByOwner(
            address(vaultAddress),
            { mint: address(USDC_MINT) },
            { encoding: 'jsonParsed' },
          ).send(),
        ]);
        const usdcBalance = usdcAccountsResult.value.length > 0
          ? BigInt((usdcAccountsResult.value[0].account.data as any).parsed.info.tokenAmount.amount)
          : 0n;

        const needMoreSol = solBalanceResult.value < LOW_SOL_THRESHOLD;
        const needMoreUsdc = usdcBalance < LOW_USDC_THRESHOLD;
      
        let description: string | undefined = undefined;
        if (needMoreSol && needMoreUsdc){
          description = 'Your SOL and USDC balances are low. Deposit some SOL & USDC to start earning up to 10% APY.'
        }
        else if (needMoreSol){
          description = 'Your SOL balance is low. Deposit some SOL to conver transaction fees and start earning up to 10% APY.'
        }
        else if (needMoreUsdc){
          description = 'Your USDC balance is low. Deposit USDC to start earning up to 10% APY.'
        }

        if (description){
          suggestions.push({
            id: 'fund-wallet',
            type: 'fund_wallet_from_seeker',
            title: 'Fund',
            description: description,
            color: '#000000',
            buttonTitle: 'Fund',
          });
        }
        
      } catch (err) {
        console.error('Error checking balances for suggestions:', err);
      }
    }

    // --- Recovery keys suggestion ---
    if (threshold && memberCount && threshold >= memberCount) {
      suggestions.push({
        id: 'add-recovery',
        type: 'add_recovery',
        title: 'Add recovery keys',
        description: 'Your vault has no recovery keys. Add a recovery wallet to protect against losing access.',
        color: '#F5A623',
        buttonTitle: 'Set Up',
      });
    }

    // --- Update app suggestion ---
    if (appVersion && isVersionOlder(appVersion, LATEST_APP_VERSION)) {
      suggestions.push({
        id: 'update-app',
        type: 'link',
        title: 'App update available',
        description: 'A new version of Cashflow is available. Update to get the latest features and improvements.',
        color: '#007AFF',
        // buttonTitle: 'Update',
        // url: 'https://store.solanamobile.com/products/cashflow',
      });
    }

    suggestions.push({
      id: 'link-twitter',
      type: 'link',
      title: 'Build in public',
      description: 'We build Cashflow in public with every day video updates. Follow @cashflow_fi on X.',
      color: '#000000',
      buttonTitle: 'Follow',
      url: 'https://x.com/cashflow_fi',
    });


    // --- Transfer position suggestions ---
    // if (vaultAddress) {
    //   try {
    //     const kaminoPositions = await kaminoManager.getWalletPositions(vaultAddress);

    //     for (const pos of kaminoPositions) {
    //       const mint = (pos as any).mint;
    //       const tokenInfo = mint ? SUPPORTED_TOKENS_BY_MINT[mint] : undefined;
    //       const symbol = tokenInfo?.symbol ?? '';
    //       const uiAmount = Number((pos as any).amount ?? 0) / 10 ** (tokenInfo?.decimals ?? 0);

    //       if (uiAmount > 0 && (symbol === 'USDC' || symbol === 'USDS')) {
    //         suggestions.push({
    //           id: `transfer-kamino-${symbol}-to-jupiter`,
    //           type: 'transfer_position',
    //           title: `Move ${symbol} to Jupiter`,
    //           description: `You have ${uiAmount.toFixed(2)} ${symbol} earning on Kamino. Jupiter Lend currently offers higher rates for similar assets.`,
    //           color: '#19C394',
    //           buttonTitle: 'View Earn',
    //           transferPosition: {
    //             from: { protocol: EarnTokenType.KAMINO, mint, symbol, apy: 0 },
    //             to: { protocol: EarnTokenType.JUPITER, mint: '', symbol: 'JupSOL', apy: 0 },
    //           },
    //         });
    //       }
    //     }
    //   } catch (err) {
    //     console.error('Error checking positions for suggestions:', err);
    //   }
    // }

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
