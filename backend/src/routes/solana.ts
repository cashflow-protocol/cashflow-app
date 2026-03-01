import { Router, Request, Response } from 'express';
import { createSolanaRpc, address } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Base64EncodedWireTransaction } from '@solana/kit';
import { DBManager, JitoManager, TokenManager } from '../managers';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';

const router = Router();
const dbManager = new DBManager();
const jitoManager = new JitoManager();
const tokenManager = new TokenManager();
const kShouldSimulate = true;

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// BigInt-safe JSON replacer (RPC returns BigInt for unitsConsumed, etc.)
const bigIntReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

// POST /solana/v1/send - Send a signed transaction on-chain
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { transaction, transactionId } = req.body;

    if (!transaction || typeof transaction !== 'string') {
      res.status(400).json({ success: false, error: 'transaction (base64) is required' });
      return;
    }

    console.log('Should simulate:', kShouldSimulate);
    if (kShouldSimulate){
      // Simulate first to get detailed error info (including `err` field)
      const simResult = await rpc
        .simulateTransaction(transaction as Base64EncodedWireTransaction, {
          encoding: 'base64',
          commitment: 'confirmed',
          sigVerify: false,
        })
        .send();

      if (simResult.value.err) {
        const errJson = JSON.stringify(simResult.value.err, bigIntReplacer);
        console.error('Simulation error:', errJson);
        console.error('Simulation logs:', simResult.value.logs);
        res.status(400).json({
          success: false,
          error: 'Transaction simulation failed',
          simulationError: JSON.parse(errJson),
          logs: simResult.value.logs,
          unitsConsumed: Number(simResult.value.unitsConsumed ?? 0),
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    const signature = await rpc
      .sendTransaction(transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      })
      .send();

    // Update transaction record with on-chain signature
    if (transactionId) {
      await dbManager.submitTransaction(transactionId, signature);
    }

    res.json({
      success: true,
      signature,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error sending transaction:', error?.message, error?.context);

    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to send transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /solana/v1/send-bundle - Send multiple signed transactions as a Jito bundle
router.post('/send-bundle', async (req: Request, res: Response) => {
  try {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 5) {
      res.status(400).json({
        success: false,
        error: 'transactions must be an array of 1-5 base64-encoded signed transactions',
      });
      return;
    }

    console.log('Should simulate:', kShouldSimulate);
    if (kShouldSimulate){
      // Simulate the full bundle via Helius (all txs together, respecting state changes)
      const simResponse = await fetch(`${rpcUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateBundle',
          params: [
            { encodedTransactions: transactions },
            {
              preExecutionAccountsConfigs: transactions.map(() => null),
              postExecutionAccountsConfigs: transactions.map(() => null),
              simulationBank: 'tip',
              skipSigVerify: true,
              replaceRecentBlockhash: true,
            },
          ],
        }),
      });
      const simData: any = await simResponse.json();

      if (simData.error) {
        console.error('Bundle simulation RPC error:', JSON.stringify(simData.error));
        res.status(400).json({
          success: false,
          error: `Bundle simulation RPC error: ${simData.error.message || JSON.stringify(simData.error)}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const simValue = simData.result?.value;
      console.log(`Bundle simulation summary: ${simValue?.summary} result:`, simValue);

      if (simValue?.summary !== 'succeeded') {
        // Find the first failing transaction for detailed logs
        const failedTxIndex = simValue?.transactionResults?.findIndex((r: any) => r.err !== null) ?? -1;
        const failedResult = failedTxIndex >= 0 ? simValue.transactionResults[failedTxIndex] : null;
        console.error(`Bundle simulation failed at tx[${failedTxIndex}]:`, JSON.stringify(simValue?.summary));
        if (failedResult) {
          console.error('Simulation logs:', failedResult.logs);
        }
        res.status(400).json({
          success: false,
          error: `Bundle simulation failed at transaction ${failedTxIndex}`,
          simulationError: typeof simValue?.summary === 'object' ? simValue.summary : { summary: simValue?.summary },
          logs: failedResult?.logs ?? [],
          failedTransactionIndex: failedTxIndex,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }


    // Send bundle via Jito
    const bundleId = await jitoManager.sendBundle(transactions);
    console.log(`Jito bundle sent: ${bundleId} (${transactions.length} txs)`);

    // Poll for confirmation (up to ~30s)
    let status = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      status = await jitoManager.getBundleStatus(bundleId);
      if (status?.confirmation_status === 'confirmed' || status?.confirmation_status === 'finalized') break;
      if (status?.err) break;
    }

    if (status?.err) {
      console.error('Jito bundle failed:', JSON.stringify(status.err));
      res.status(400).json({
        success: false,
        error: 'Bundle execution failed',
        bundleId,
        bundleError: status.err,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      bundleId,
      status: status?.confirmation_status ?? 'pending',
      slot: status?.slot ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error sending bundle:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to send bundle',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /solana/v1/wallet-balance - Get wallet balance for a specific token
const SOL_MINT = 'So11111111111111111111111111111111111111112';

router.get('/wallet-balance', async (req: Request, res: Response) => {
  try {
    const { walletAddress, mint } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string' || !mint || typeof mint !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress and mint query params are required' });
      return;
    }

    const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
    const decimals = tokenInfo?.decimals ?? 0;
    let uiAmount = 0;
    let amount = '0';

    if (mint === SOL_MINT) {
      const balanceResult = await rpc.getBalance(address(walletAddress)).send();
      amount = balanceResult.value.toString();
      uiAmount = Number(balanceResult.value) / 10 ** decimals;
    } else {
      const accounts = await rpc.getTokenAccountsByOwner(
        address(walletAddress),
        { mint: address(mint) },
        { encoding: 'jsonParsed' },
      ).send();

      if (accounts.value.length > 0) {
        const parsed = accounts.value[0].account.data as any;
        amount = parsed.parsed.info.tokenAmount.amount ?? 0;
        uiAmount = parsed.parsed.info.tokenAmount.uiAmount ?? 0;
      }
    }

    console.log('walletBalance uiAmount:', uiAmount);

    res.json({
      success: true,
      data: { mint, amount, uiAmount },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet balance',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /solana/v1/assets - Get all wallet assets via Helius DAS API
router.get('/assets', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress query param is required' });
      return;
    }

    // Call Helius DAS getAssetsByOwner (works on the same RPC URL)
    const dasResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-assets',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
          },
        },
      }),
    });
    const dasData: any = await dasResponse.json();

    console.log('[assets] Helius DAS response:', JSON.stringify(dasData));

    if (dasData.error) {
      throw new Error(dasData.error.message || 'DAS API error');
    }

    const items: any[] = dasData.result?.items ?? [];
    const nativeBalance = dasData.result?.nativeBalance;

    // Get all vault addresses from earn tokens to filter out LP/receipt tokens
    const vaultAddresses = await EarnTokenModel.distinct('vaultAddress');
    const vaultAddressSet = new Set<string>(vaultAddresses);

    const assets: {
      mint: string;
      symbol: string;
      name: string;
      decimals: number;
      logoUrl: string;
      amount: string;
      uiAmount: number;
      usdValue: number;
    }[] = [];

    // Add native SOL from nativeBalance
    if (nativeBalance && nativeBalance.lamports > 0) {
      const solUiAmount = nativeBalance.lamports / 1e9;
      const solPrice = nativeBalance.price_per_sol ?? 0;
      assets.push({
        mint: 'native',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        logoUrl: SUPPORTED_TOKENS_BY_MINT[SOL_MINT]?.logoUrl ?? '',
        amount: String(nativeBalance.lamports),
        uiAmount: solUiAmount,
        usdValue: nativeBalance.total_price ?? solUiAmount * solPrice,
      });
    }

    // Collect unknown mints to fetch from Jupiter via TokenManager
    const unknownMints: string[] = [];
    for (const item of items) {
      if (item.interface !== 'FungibleToken' && item.interface !== 'FungibleAsset') continue;
      if (vaultAddressSet.has(item.id)) continue;
      if (!item.token_info?.balance || item.token_info.balance === 0) continue;
      if ((item.token_info.decimals ?? 0) === 0) continue;
      if (!SUPPORTED_TOKENS_BY_MINT[item.id]) {
        unknownMints.push(item.id);
      }
    }

    const jupiterTokens = unknownMints.length > 0
      ? await tokenManager.getTokensByMints(unknownMints)
      : new Map();

    // Add fungible SPL tokens
    for (const item of items) {
      if (item.interface !== 'FungibleToken' && item.interface !== 'FungibleAsset') continue;

      // Skip LP/receipt tokens from Jupiter Lend, Kamino, Drift
      if (vaultAddressSet.has(item.id)) continue;

      const tokenInfo = item.token_info;
      if (!tokenInfo || !tokenInfo.balance || tokenInfo.balance === 0) continue;

      const decimals: number = tokenInfo.decimals ?? 0;
      if (decimals == 0) continue;
      const balance: number = tokenInfo.balance;
      const uiAmount = balance / 10 ** decimals;
      const mint: string = item.id;
      const metadata = item.content?.metadata;
      const known = SUPPORTED_TOKENS_BY_MINT[mint];
      const cached = jupiterTokens.get(mint);

      const pricePerToken: number = tokenInfo.price_info?.price_per_token ?? cached?.usdPrice ?? 0;
      const usdValue = uiAmount * pricePerToken;

      assets.push({
        mint,
        symbol: mint === SOL_MINT ? 'WSOL' : (known?.symbol ?? cached?.symbol ?? tokenInfo.symbol ?? metadata?.symbol ?? mint.slice(0, 6)),
        name: mint === SOL_MINT ? 'Wrapped SOL' : (known?.name ?? cached?.name ?? metadata?.name ?? 'Unknown Token'),
        decimals,
        logoUrl: known?.logoUrl ?? cached?.logoUrl ?? item.content?.links?.image ?? '',
        amount: String(balance),
        uiAmount,
        usdValue,
      });
    }

    // Sort: native SOL first, then by USD value descending
    assets.sort((a, b) => {
      if (a.mint === 'native') return -1;
      if (b.mint === 'native') return 1;
      return b.usdValue - a.usdValue;
    });

    const totalUsdValue = assets.reduce((sum, a) => sum + a.usdValue, 0);

    res.json({
      success: true,
      data: { totalUsdValue, assets },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching wallet assets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet assets',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
