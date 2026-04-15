import { Router, Request, Response } from 'express';
import {
  createSolanaRpc,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  AccountRole,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi, Base64EncodedWireTransaction } from '@solana/kit';
import { DBManager, JitoManager, PriceManager, SolanaDomainManager, TokenManager, TransferManager } from '../managers';
import { TransactionAction } from '../models/Transaction';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';

const router = Router();
const dbManager = new DBManager();
const jitoManager = new JitoManager();
const tokenManager = new TokenManager();
const transferManager = new TransferManager();
const priceManager = new PriceManager();
const kShouldSimulate = true;

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

/** Rewrite ipfs.io URLs to go through our proxy for reliable mobile loading */
function proxyLogoUrl(url: string): string {
  if (!url) return url;
  const match = url.match(/^https?:\/\/ipfs\.io\/ipfs\/(.+)$/);
  if (match) return `${BACKEND_URL}/ipfs/${match[1]}`;
  return url;
}

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// BigInt-safe JSON replacer (RPC returns BigInt for unitsConsumed, etc.)
const bigIntReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

// POST /solana/v1/submit-bundle-signatures - Store bundle signatures for a transaction
router.post('/submit-bundle-signatures', async (req: Request, res: Response) => {
  try {
    const { transactionId, signatures } = req.body;

    if (!transactionId || !Array.isArray(signatures) || signatures.length === 0) {
      res.status(400).json({ success: false, error: 'transactionId and signatures[] are required' });
      return;
    }

    await dbManager.submitBundleTransaction(transactionId, signatures);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Submit bundle signatures error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit bundle signatures' });
  }
});

// POST /solana/v1/send - Send a signed transaction onchain
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
          replaceRecentBlockhash: true,
        })
        .send();

      if (simResult.value.err) {
        const errJson = JSON.stringify(simResult.value.err, bigIntReplacer);
        console.error('Simulation error:', errJson);
        console.error('Simulation logs:', simResult.value.logs);

        const simLogs: string[] = (simResult.value.logs as string[]) ?? [];
        const spendingLimitExceeded = simLogs.some((log: string) =>
          log.includes('SpendingLimitExceeded'),
        );

        res.status(400).json({
          success: false,
          error: spendingLimitExceeded
            ? 'Spending limit exceeded'
            : 'Transaction simulation failed',
          errorCode: spendingLimitExceeded ? 'SPENDING_LIMIT_EXCEEDED' : undefined,
          simulationError: JSON.parse(errJson),
          logs: simLogs,
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

    // Update transaction record with onchain signature
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
// If admin tx fee payer pubkey is a required signer, auto-signs with the admin key.
router.post('/send-bundle', async (req: Request, res: Response) => {
  try {
    let { transactions, transactionId } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 5) {
      res.status(400).json({
        success: false,
        error: 'transactions must be an array of 1-5 base64-encoded signed transactions',
      });
      return;
    }

    // ── Admin co-signing ──
    // If ADMIN_ALL_TX_FEE_PAYER_PRIVATE_KEY is configured, deserialize each tx,
    // check if the admin pubkey is a required signer, and sign if so.
    if (process.env.ADMIN_ALL_TX_FEE_PAYER_PRIVATE_KEY) {
      const { VersionedTransaction } = await import('@solana/web3.js');
      const { getAdminTxFeePayerKeypair } = await import('../services/adminFeePayer');
      const adminKeypair = getAdminTxFeePayerKeypair();
      const adminPubkeyStr = adminKeypair.publicKey.toBase58();

      transactions = transactions.map((txBase64: string) => {
        const txBytes = Buffer.from(txBase64, 'base64');
        const tx = VersionedTransaction.deserialize(txBytes);
        const staticKeys = tx.message.staticAccountKeys.map((k: any) => k.toBase58());
        const numRequiredSignatures = tx.message.header.numRequiredSignatures;

        // Check if admin key is among the required signers (first N static keys)
        const adminIndex = staticKeys.slice(0, numRequiredSignatures).indexOf(adminPubkeyStr);
        if (adminIndex >= 0) {
          tx.sign([adminKeypair]);
          return Buffer.from(tx.serialize()).toString('base64');
        }
        return txBase64;
      });
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

      // Helius simulateBundle may return err as null (success), {"Ok":null} (success), or an error object.
      const isTxError = (err: any) => err !== null && err !== undefined && !('Ok' in (err ?? {}));

      if (simValue?.summary !== 'succeeded') {
        // Find the first failing transaction for detailed logs
        const failedTxIndex = simValue?.transactionResults?.findIndex((r: any) => isTxError(r.err)) ?? -1;
        const failedResult = failedTxIndex >= 0 ? simValue.transactionResults[failedTxIndex] : null;
        console.error(`Bundle simulation failed at tx[${failedTxIndex}]:`, JSON.stringify(simValue?.summary));
        if (failedResult) {
          console.error('Simulation logs:', failedResult.logs);
          console.error('Simulation err:', JSON.stringify(failedResult.err));
        }

        // If no individual transaction has a real error, proceed anyway —
        // the summary might be misleading (e.g. all txs return err: {"Ok":null}).
        if (failedTxIndex === -1) {
          console.log('No individual tx errors found despite summary — proceeding with bundle');
        } else {
          // Check ALL transaction logs for known Anchor errors (the spending-limit
          // failure may be in a later tx than the first one flagged as failed).
          const allBundleLogs: string[] = (simValue?.transactionResults ?? []).flatMap(
            (r: any) => r?.logs ?? [],
          );
          const spendingLimitExceeded = allBundleLogs.some((log: string) =>
            log.includes('SpendingLimitExceeded'),
          );

          const failedLogs: string[] = failedResult?.logs ?? [];

          res.status(400).json({
            success: false,
            error: spendingLimitExceeded
              ? 'Spending limit exceeded'
              : `Bundle simulation failed at transaction ${failedTxIndex}`,
            errorCode: spendingLimitExceeded ? 'SPENDING_LIMIT_EXCEEDED' : undefined,
            simulationError: typeof simValue?.summary === 'object' ? simValue.summary : { summary: simValue?.summary },
            logs: failedLogs,
            failedTransactionIndex: failedTxIndex,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
    }


    // Extract real transaction IDs (first signature of each fully-signed tx) and
    // store them BEFORE sending to Jito, so the Helius webhook can match them
    // as soon as the bundle lands on-chain — no race condition.
    if (transactionId) {
      const { VersionedTransaction: VTx } = await import('@solana/web3.js');
      const { getBase58Decoder } = await import('@solana/kit');
      const b58 = getBase58Decoder();
      const txSignatures = transactions.map((txBase64: string) => {
        const tx = VTx.deserialize(Buffer.from(txBase64, 'base64'));
        return b58.decode(tx.signatures[0]);
      });
      await dbManager.submitBundleTransaction(transactionId, txSignatures);
      console.log(`Bundle signatures pre-stored for ${transactionId}: ${txSignatures.map((s: string) => s.slice(0, 8)).join(', ')}`);
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
      // Jito returns {"Ok": null} on success — only break on actual errors
      if (status?.err && !('Ok' in status.err)) break;
    }

    if (status?.err && !('Ok' in status.err)) {
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
      transactions: status?.transactions ?? [],
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

// POST /solana/v1/transfer - Get raw transfer instructions for Squads vault flow
router.post('/transfer', async (req: Request, res: Response) => {
  try {
    const { mint, amount, ownerAddress, destinationAddress, walletAddress, decimals } = req.body;

    if (!mint || !amount || !ownerAddress || !destinationAddress || !walletAddress || decimals == null) {
      res.status(400).json({
        success: false,
        error: 'mint, amount, ownerAddress, destinationAddress, walletAddress, and decimals are required',
      });
      return;
    }

    console.log(`TRANSFER ownerAddress: ${ownerAddress}, dest: ${destinationAddress}, mint: ${mint}, amount: ${amount}, decimals: ${decimals}`);

    const instructions = await transferManager.getTransferInstructions(
      mint,
      amount,
      ownerAddress,
      destinationAddress,
      decimals,
    );

    const record = await dbManager.createTransaction({
      action: TransactionAction.TRANSFER,
      mint,
      amount,
      walletAddress,
      destinationAddress,
    });

    res.json({
      success: true,
      transactionId: record._id,
      instructions,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error creating transfer instructions:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to create transfer instructions',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /solana/v1/build-transfer - Build a full unsigned transaction for a direct wallet-to-wallet transfer
router.post('/build-transfer', async (req: Request, res: Response) => {
  try {
    const { fromAddress, toAddress, mint, amount, decimals } = req.body;

    if (!fromAddress || !toAddress || !mint || !amount || decimals == null) {
      res.status(400).json({
        success: false,
        error: 'fromAddress, toAddress, mint, amount, and decimals are required',
      });
      return;
    }

    // Get serialized instructions from TransferManager
    const serializedIxs = await transferManager.getTransferInstructions(
      mint, amount, fromAddress, toAddress, decimals,
    );

    // Convert serialized instructions back to @solana/kit instruction format
    const instructions = serializedIxs.map((ix) => ({
      programAddress: address(ix.programId),
      accounts: ix.accounts.map((acc) => ({
        address: address(acc.pubkey),
        role: acc.isSigner && acc.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : acc.isSigner
            ? AccountRole.READONLY_SIGNER
            : acc.isWritable
              ? AccountRole.WRITABLE
              : AccountRole.READONLY,
      })),
      data: new Uint8Array(Buffer.from(ix.data, 'base64')),
    }));

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(fromAddress), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => instructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    const compiled = compileTransaction(transactionMessage);
    const transaction = getBase64EncodedWireTransaction(compiled);

    res.json({
      success: true,
      transaction,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error building transfer transaction:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to build transfer transaction',
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

// GET /solana/v1/empty-token-accounts - Count empty (zero-balance) token accounts on a wallet
router.get('/empty-token-accounts', async (req: Request, res: Response) => {
  try {
    const walletAddress = typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : '';
    if (!walletAddress) {
      res.status(400).json({ success: false, error: 'walletAddress query param is required' });
      return;
    }

    const accounts = await rpc.getTokenAccountsByOwner(
      address(walletAddress),
      { programId: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
      { encoding: 'jsonParsed' },
    ).send();

    const emptyAccounts = accounts.value.filter((acc) => {
      const parsed = acc.account.data as any;
      const amount = BigInt(parsed.parsed.info.tokenAmount.amount);
      return amount === 0n;
    });

    res.json({
      success: true,
      data: { total: accounts.value.length, empty: emptyAccounts.length },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching empty token accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch empty token accounts',
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
      isVerified: boolean;
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
        logoUrl: proxyLogoUrl(SUPPORTED_TOKENS_BY_MINT[SOL_MINT]?.logoUrl ?? ''),
        amount: String(nativeBalance.lamports),
        uiAmount: solUiAmount,
        usdValue: nativeBalance.total_price ?? solUiAmount * solPrice,
        isVerified: true,
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
        logoUrl: proxyLogoUrl(known?.logoUrl ?? cached?.logoUrl ?? item.content?.links?.image ?? ''),
        amount: String(balance),
        uiAmount,
        usdValue,
        isVerified: !!known || cached?.isVerified || false,
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

// GET /solana/v1/sol-price - Return cached SOL price
router.get('/sol-price', (_req: Request, res: Response) => {
  const price = priceManager.getPrice('SOL');
  res.json({ success: true, data: { price } });
});

// POST /solana/v1/resolve-domains - Resolve Solana wallet addresses to primary domain names
router.post('/resolve-domains', async (req: Request, res: Response) => {
  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({ success: false, error: 'addresses array required' });
    }

    const domains = await SolanaDomainManager.lookup(addresses);
    res.json({ success: true, data: domains });
  } catch (error) {
    console.error('Error resolving domains:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve domains' });
  }
});

// POST /solana/v1/resolve-name - Resolve a domain (e.g. mike.sol, mike.skr) to a wallet address
router.post('/resolve-name', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name required' });
    }

    const resolved = await SolanaDomainManager.resolve(name);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'Domain not found' });
    }
    res.json({ success: true, data: { address: resolved } });
  } catch (error) {
    console.error('Error resolving name:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve name' });
  }
});

export default router;
