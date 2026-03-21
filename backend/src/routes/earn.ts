import { Router, Request, Response } from 'express';
import { DBManager, JupiterManager, KaminoManager, DriftManager, PriceManager } from '../managers';
import { LookupManager } from '../managers/LookupManager';
import { EarnTokenModel } from '../models/EarnToken';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { TransactionAction, UserCostBasisModel } from '../models';
import { EarnTokenType, type IBalance } from '../types';
import { notifyAdmin } from '../services/telegramManager';
import { calculateFee, buildFeeTransferInstructions, createFeeRecord } from '../services/feeService';

const router = Router();
const dbManager = new DBManager();
const priceManager = new PriceManager();

// GET /earn/v1/tokens - Get earn tokens from MongoDB
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;
    const typeFilter = type && typeof type === 'string' ? { type } : undefined;
    const tokens = await dbManager.getTokens(typeFilter);

    res.json({
      success: true,
      data: tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching earn tokens from database:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch earn tokens',
      timestamp: new Date().toISOString(),
    });
  }
});

// Manager instances
const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();

let driftManager: DriftManager | null = null;
let driftReady: Promise<void> | null = null;
try {
  driftManager = new DriftManager();
  driftReady = driftManager.initialize();
} catch {
  // Drift not configured (missing env vars)
}

router.get('/positions', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress query param is required' });
      return;
    }
    const positionPromises: [string, Promise<any[]>][] = [
      ['jupiter', jupiterManager.getWalletPositions(walletAddress)],
      ['kamino', kaminoManager.getWalletPositions(walletAddress)],
    ];
    if (driftManager) {
      positionPromises.push(
        ['drift', (async () => { await driftReady; return driftManager!.getWalletPositions(walletAddress); })()],
      );
    }

    const results = await Promise.allSettled(positionPromises.map(([, p]) => p));
    const settled: Record<string, any[]> = {};
    results.forEach((r, i) => {
      const name = positionPromises[i][0];
      if (r.status === 'fulfilled') {
        settled[name] = r.value;
      } else {
        console.error(`[positions] ${name} failed:`, r.reason?.message ?? r.reason);
        settled[name] = [];
      }
    });

    const positions = [
      ...settled.jupiter
        .filter((p: any) => Number(p.underlyingAssets) > 0)
        .map((p: any) => {
          const mint = p.token.assetAddress;
          const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
          const decimals = tokenInfo?.decimals ?? 0;
          const symbol = tokenInfo?.symbol ?? '';
          const uiAmount = Number(p.underlyingAssets) / 10 ** decimals;
          return {
            type: EarnTokenType.JUPITER,
            mint,
            symbol,
            balance: {
              amount: p.underlyingAssets,
              decimals,
              uiAmount,
              usdValue: priceManager.getUsdValue(symbol, uiAmount),
            } as IBalance,
          };
        }),
      ...(settled.kamino ?? []).map((p: any) => {
        const tokenInfo = SUPPORTED_TOKENS_BY_MINT[p.mint];
        const decimals = tokenInfo?.decimals ?? 0;
        const symbol = tokenInfo?.symbol ?? '';
        const uiAmount = Number(p.amount) / 10 ** decimals;
        return {
          type: EarnTokenType.KAMINO,
          mint: p.mint,
          vaultAddress: p.vaultAddress,
          symbol,
          balance: {
            amount: p.amount,
            decimals,
            uiAmount,
            usdValue: priceManager.getUsdValue(symbol, uiAmount),
          } as IBalance,
        };
      }),
      ...(settled.drift ?? []).map((p: any) => {
        const tokenInfo = SUPPORTED_TOKENS_BY_MINT[p.mint];
        const decimals = tokenInfo?.decimals ?? 0;
        const symbol = tokenInfo?.symbol ?? '';
        const uiAmount = Number(p.amount) / 10 ** decimals;
        return {
          type: EarnTokenType.DRIFT,
          mint: p.mint,
          vaultAddress: p.vaultAddress,
          symbol,
          balance: {
            amount: p.amount,
            decimals,
            uiAmount,
            usdValue: priceManager.getUsdValue(symbol, uiAmount),
          } as IBalance,
        };
      }),
    ];

    res.json({
      success: true,
      data: positions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching wallet positions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wallet positions',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /earn/v1/earnings - Get user earnings and cost basis data
router.get('/earnings', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress query param is required' });
      return;
    }

    // Fetch cost basis records and current positions in parallel
    const [costBasisRecords, positionsRes] = await Promise.all([
      UserCostBasisModel.find({ walletAddress }).lean(),
      // Re-use the positions logic: fetch from all protocols
      (async () => {
        const positionPromises: [string, Promise<any[]>][] = [
          ['jupiter', jupiterManager.getWalletPositions(walletAddress)],
          ['kamino', kaminoManager.getWalletPositions(walletAddress)],
        ];
        if (driftManager) {
          positionPromises.push(
            ['drift', (async () => { await driftReady; return driftManager!.getWalletPositions(walletAddress); })()],
          );
        }
        const results = await Promise.allSettled(positionPromises.map(([, p]) => p));
        const settled: Record<string, any[]> = {};
        results.forEach((r, i) => {
          const name = positionPromises[i][0];
          settled[name] = r.status === 'fulfilled' ? r.value : [];
        });
        return settled;
      })(),
    ]);

    // Build current position amounts by mint (sum across protocols)
    const currentPositionByMint: Record<string, { amount: bigint; usdValue: number }> = {};

    const addPosition = (mint: string, amount: string, symbol: string, decimals: number) => {
      const uiAmount = Number(amount) / 10 ** decimals;
      const usdValue = priceManager.getUsdValue(symbol, uiAmount);
      if (!currentPositionByMint[mint]) {
        currentPositionByMint[mint] = { amount: 0n, usdValue: 0 };
      }
      currentPositionByMint[mint].amount += BigInt(amount);
      currentPositionByMint[mint].usdValue += usdValue;
    };

    for (const p of (positionsRes.jupiter ?? [])) {
      const mint = p.token.assetAddress;
      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
      if (Number(p.underlyingAssets) > 0) {
        addPosition(mint, p.underlyingAssets, tokenInfo?.symbol ?? '', tokenInfo?.decimals ?? 0);
      }
    }
    for (const p of (positionsRes.kamino ?? [])) {
      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[p.mint];
      addPosition(p.mint, p.amount, tokenInfo?.symbol ?? '', tokenInfo?.decimals ?? 0);
    }
    for (const p of (positionsRes.drift ?? [])) {
      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[p.mint];
      addPosition(p.mint, p.amount, tokenInfo?.symbol ?? '', tokenInfo?.decimals ?? 0);
    }

    // Calculate earnings per mint
    let lifetimeEarnedUsd = 0;
    const perMint: {
      mint: string;
      symbol: string;
      totalDeposited: string;
      totalWithdrawn: string;
      currentPosition: string;
      realizedProfit: string;
      unrealizedProfit: string;
      feesCollected: string;
      earningsUsd: number;
    }[] = [];

    // Collect all mints from cost basis + current positions
    const allMints = new Set([
      ...costBasisRecords.map((r) => r.mint),
      ...Object.keys(currentPositionByMint),
    ]);

    for (const mint of allMints) {
      const cb = costBasisRecords.find((r) => r.mint === mint);
      const totalDeposited = BigInt(cb?.totalDeposited ?? '0');
      const totalWithdrawn = BigInt(cb?.totalWithdrawn ?? '0');
      const feesCollected = BigInt(cb?.totalFeesCollected ?? '0');
      const currentPosition = currentPositionByMint[mint]?.amount ?? 0n;
      const currentUsdValue = currentPositionByMint[mint]?.usdValue ?? 0;

      // Realized profit: what was already withdrawn in profit
      const realizedProfit = totalWithdrawn > totalDeposited ? totalWithdrawn - totalDeposited : 0n;

      // Unrealized profit: current position value vs remaining principal
      const remainingPrincipal = totalDeposited > totalWithdrawn ? totalDeposited - totalWithdrawn : 0n;
      const unrealizedProfit = currentPosition > remainingPrincipal ? currentPosition - remainingPrincipal : 0n;

      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
      const decimals = tokenInfo?.decimals ?? 6;
      const symbol = tokenInfo?.symbol ?? mint.slice(0, 6);

      // Convert unrealized + realized profit to USD
      const unrealizedUsd = priceManager.getUsdValue(symbol, Number(unrealizedProfit) / 10 ** decimals);
      const realizedUsd = priceManager.getUsdValue(symbol, Number(realizedProfit) / 10 ** decimals);
      const earningsUsd = unrealizedUsd + realizedUsd;
      lifetimeEarnedUsd += earningsUsd;

      perMint.push({
        mint,
        symbol,
        totalDeposited: totalDeposited.toString(),
        totalWithdrawn: totalWithdrawn.toString(),
        currentPosition: currentPosition.toString(),
        realizedProfit: realizedProfit.toString(),
        unrealizedProfit: unrealizedProfit.toString(),
        feesCollected: feesCollected.toString(),
        earningsUsd,
      });
    }

    res.json({
      success: true,
      data: {
        lifetimeEarnedUsd,
        perMint,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch earnings',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /earn/v1/fee-preview - Preview the profit fee for a withdrawal
router.get('/fee-preview', async (req: Request, res: Response) => {
  try {
    const { walletAddress, mint, amount } = req.query;
    if (!walletAddress || !mint || !amount || typeof walletAddress !== 'string' || typeof mint !== 'string' || typeof amount !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress, mint, and amount query params are required' });
      return;
    }

    const { feeAmount, profitAmount } = await calculateFee(walletAddress, mint, amount);
    const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
    const decimals = tokenInfo?.decimals ?? 6;

    res.json({
      success: true,
      data: {
        feeAmount: feeAmount.toString(),
        profitAmount: profitAmount.toString(),
        feeUiAmount: Number(feeAmount) / 10 ** decimals,
        profitUiAmount: Number(profitAmount) / 10 ** decimals,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error calculating fee preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate fee preview',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /earn/v1/deposit - Get unsigned deposit transaction (or raw instructions)
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { type, mint, vaultAddress, amount, walletAddress, ownerAddress, returnInstructions } = req.body;
    const authority = ownerAddress || walletAddress;

    const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
    console.log(`DEPOSIT walletAddress: ${walletAddress}, ownerAddress: ${authority}, type: ${type}, mint: ${mint}, symbol: ${tokenInfo?.symbol}, amount (raw): ${amount}, decimals: ${tokenInfo?.decimals}, vaultAddress: ${vaultAddress}, returnInstructions: ${!!returnInstructions}`)

    // Validate minimum deposit amount
    const earnToken = await EarnTokenModel.findOne({ type, mint, vaultAddress, status: 'active' }).lean();
    if (earnToken?.minDepositAmount && earnToken.minDepositAmount !== '0' && BigInt(amount) < BigInt(earnToken.minDepositAmount)) {
      const decimals = tokenInfo?.decimals ?? 0;
      const minUi = (Number(earnToken.minDepositAmount) / 10 ** decimals).toString();
      res.status(400).json({ success: false, error: `Minimum deposit is ${minUi} ${tokenInfo?.symbol ?? ''}` });
      return;
    }

    // Return raw instructions for Squads vault flow
    if (returnInstructions) {
      let instructions: any[];
      switch (type) {
        case EarnTokenType.JUPITER:
          instructions = await jupiterManager.getDepositInstructions(mint, amount, authority, walletAddress);
          break;
        case EarnTokenType.KAMINO: {
          const decimals = tokenInfo?.decimals ?? 0;
          const decimalAmount = (Number(amount) / 10 ** decimals).toString();
          instructions = await kaminoManager.getDepositInstructions(vaultAddress, decimalAmount, authority);
          break;
        }
        case EarnTokenType.DRIFT: {
          if (!driftManager) {
            res.status(400).json({ success: false, error: 'Drift not configured' });
            return;
          }
          await driftReady;
          instructions = await driftManager.getDepositInstructions(vaultAddress, amount, authority);
          break;
        }
        default:
          res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
          return;
      }

      console.log(`DEPOSIT returnInstructions: got ${instructions?.length ?? 'undefined'} instructions for type=${type}`);
      if (!instructions || instructions.length === 0) {
        console.error(`DEPOSIT returnInstructions: EMPTY instructions for type=${type}, mint=${mint}, amount=${amount}`);
      }

      // Collect extra LUTs (e.g. Kamino vault-specific lookup table)
      const extraLookupTables: string[] = [];
      if (type === EarnTokenType.KAMINO && vaultAddress) {
        const vaultDoc = await EarnTokenModel.findOne({ type, vaultAddress }).lean();
        const vaultLut = vaultDoc?.kaminoToken?.state?.vaultLookupTable;
        if (vaultLut) extraLookupTables.push(vaultLut);
      }

      const record = await dbManager.createTransaction({
        action: TransactionAction.DEPOSIT,
        type,
        mint,
        vaultAddress,
        amount,
        walletAddress,
      });

      res.json({
        success: true,
        transactionId: record._id,
        instructions,
        lookupTableAddress: LookupManager.lookupTableAddress,
        extraLookupTables,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Legacy flow: return full unsigned transaction
    let transaction: string;
    switch (type) {
      case EarnTokenType.JUPITER:
        console.log(`  -> Jupiter deposit: raw amount = ${amount}`);
        transaction = await jupiterManager.deposit(mint, amount, walletAddress);
        break;
      case EarnTokenType.KAMINO: {
        const decimals = tokenInfo?.decimals ?? 0;
        const decimalAmount = (Number(amount) / 10 ** decimals).toString();
        console.log(`  -> Kamino deposit: raw=${amount}, decimal=${decimalAmount}, decimals=${decimals}`);
        transaction = await kaminoManager.deposit(vaultAddress, decimalAmount, walletAddress);
        break;
      }
      case EarnTokenType.DRIFT: {
        if (!driftManager) {
          res.status(400).json({ success: false, error: 'Drift not configured' });
          return;
        }
        await driftReady;
        transaction = await driftManager.deposit(vaultAddress, amount, walletAddress);
        break;
      }
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    const record = await dbManager.createTransaction({
      action: TransactionAction.DEPOSIT,
      type,
      mint,
      vaultAddress,
      amount,
      walletAddress,
      unsignedTransaction: transaction,
    });

    const tokenInfo2 = SUPPORTED_TOKENS_BY_MINT[mint];
    const decimals2 = tokenInfo2?.decimals ?? 0;
    const uiAmount = (Number(amount) / 10 ** decimals2).toFixed(decimals2 > 2 ? 4 : 2);
    notifyAdmin(`💰 Deposit initiated!\n\nAmount: ${uiAmount} ${tokenInfo2?.symbol ?? mint.slice(0, 6)}\nType: ${type}\nWallet: <code>${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}</code>`);

    res.json({
      success: true,
      transactionId: record._id,
      transaction,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating deposit transaction:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create deposit transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /earn/v1/withdraw - Get unsigned withdraw transaction (or raw instructions)
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const { type, mint, vaultAddress, amount, walletAddress, ownerAddress, returnInstructions } = req.body;
    const authority = ownerAddress || walletAddress;

    // Validate minimum withdraw amount
    const earnToken = await EarnTokenModel.findOne({ type, mint, vaultAddress, status: 'active' }).lean();
    if (earnToken?.minWithdrawAmount && earnToken.minWithdrawAmount !== '0' && BigInt(amount) < BigInt(earnToken.minWithdrawAmount)) {
      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
      const decimals = tokenInfo?.decimals ?? 0;
      const minUi = (Number(earnToken.minWithdrawAmount) / 10 ** decimals).toString();
      res.status(400).json({ success: false, error: `Minimum withdrawal is ${minUi} ${tokenInfo?.symbol ?? ''}` });
      return;
    }

    // Return raw instructions for Squads vault flow
    if (returnInstructions) {
      let instructions: any[];
      switch (type) {
        case EarnTokenType.JUPITER:
          instructions = await jupiterManager.getWithdrawInstructions(mint, amount, authority, walletAddress);
          break;
        case EarnTokenType.KAMINO: {
          const decimals = SUPPORTED_TOKENS_BY_MINT[mint]?.decimals ?? 0;
          const decimalAmount = (Number(amount) / 10 ** decimals).toString();
          instructions = await kaminoManager.getWithdrawInstructions(vaultAddress, decimalAmount, authority);
          break;
        }
        case EarnTokenType.DRIFT: {
          if (!driftManager) {
            res.status(400).json({ success: false, error: 'Drift not configured' });
            return;
          }
          await driftReady;
          instructions = await driftManager.getWithdrawInstructions(vaultAddress, amount, authority);
          break;
        }
        default:
          res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
          return;
      }

      // Collect extra LUTs (e.g. Kamino vault-specific lookup table)
      const extraLookupTables: string[] = [];
      if (type === EarnTokenType.KAMINO && vaultAddress) {
        const vaultDoc = await EarnTokenModel.findOne({ type, vaultAddress }).lean();
        const vaultLut = vaultDoc?.kaminoToken?.state?.vaultLookupTable;
        if (vaultLut) extraLookupTables.push(vaultLut);
      }

      // Calculate and append profit fee instructions
      const { feeAmount, profitAmount } = await calculateFee(walletAddress, mint, amount);
      let feeAmountStr: string | undefined;
      if (feeAmount > 0n) {
        const feeInstructions = await buildFeeTransferInstructions(mint, feeAmount.toString(), authority);
        instructions.push(...feeInstructions);
        feeAmountStr = feeAmount.toString();
      }

      const record = await dbManager.createTransaction({
        action: TransactionAction.WITHDRAW,
        type,
        mint,
        vaultAddress,
        amount,
        walletAddress,
        feeAmount: feeAmountStr,
      });

      if (feeAmount > 0n) {
        await createFeeRecord({
          walletAddress,
          mint,
          withdrawTransactionId: String(record._id),
          withdrawAmount: amount,
          profitAmount: profitAmount.toString(),
          feeAmount: feeAmount.toString(),
        });
      }

      res.json({
        success: true,
        transactionId: record._id,
        instructions,
        lookupTableAddress: LookupManager.lookupTableAddress,
        extraLookupTables,
        feeAmount: feeAmountStr,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Legacy flow: return full unsigned transaction
    let transaction: string;
    switch (type) {
      case EarnTokenType.JUPITER:
        transaction = await jupiterManager.withdraw(mint, amount, walletAddress);
        break;
      case EarnTokenType.KAMINO: {
        const decimals = SUPPORTED_TOKENS_BY_MINT[mint]?.decimals ?? 0;
        const decimalAmount = (Number(amount) / 10 ** decimals).toString();
        transaction = await kaminoManager.withdraw(vaultAddress, decimalAmount, walletAddress);
        break;
      }
      case EarnTokenType.DRIFT: {
        if (!driftManager) {
          res.status(400).json({ success: false, error: 'Drift not configured' });
          return;
        }
        await driftReady;
        transaction = await driftManager.withdraw(vaultAddress, amount, walletAddress);
        break;
      }
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    const record = await dbManager.createTransaction({
      action: TransactionAction.WITHDRAW,
      type,
      mint,
      vaultAddress,
      amount,
      walletAddress,
      unsignedTransaction: transaction,
    });

    const wTokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
    const wDecimals = wTokenInfo?.decimals ?? 0;
    const wUiAmount = (Number(amount) / 10 ** wDecimals).toFixed(wDecimals > 2 ? 4 : 2);
    notifyAdmin(`📤 Withdrawal initiated!\n\nAmount: ${wUiAmount} ${wTokenInfo?.symbol ?? mint.slice(0, 6)}\nType: ${type}\nWallet: <code>${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}</code>`);

    res.json({
      success: true,
      transactionId: record._id,
      transaction,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating withdraw transaction:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create withdraw transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
