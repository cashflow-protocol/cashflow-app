import { Router, Request, Response } from 'express';
import { DBManager, JupiterManager, KaminoManager, DriftManager, PerenaManager, PriceManager } from '../managers';
import { LookupManager } from '../managers/LookupManager';
import { EarnTokenModel } from '../models/EarnToken';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { TransactionAction, UserCostBasisModel, UserModel, NotifyInterestModel } from '../models';
import { EarnTokenType, type IBalance } from '../types';
import { notifyAdmin } from '../services/telegramManager';
import type { AuthenticatedRequest } from '../middleware/auth';
import { isValidSolanaAddress } from '../utils/validation';

/**
 * Verify that the given walletAddress belongs to the authenticated user.
 * Returns true if no auth is present (v1 routes) or if the address matches.
 */
async function verifyWalletOwnership(req: Request, walletAddress: string): Promise<boolean> {
  const authReq = req as AuthenticatedRequest;
  // If no auth context (v1 routes), skip ownership check
  if (!authReq.user) return true;
  // Check if the wallet matches the user's vault address from JWT
  if (authReq.user.vaultAddress === walletAddress) return true;
  // Also check against the user's record in the database (they may have multiple addresses)
  const user = await UserModel.findOne({
    $or: [
      { vaultAddress: walletAddress },
      { publicKey: walletAddress },
    ],
  }).lean();
  if (!user) return false;
  return user.vaultAddress === authReq.user.vaultAddress;
}

const router = Router();
const dbManager = new DBManager();
const priceManager = new PriceManager();

// GET /earn/v1/tokens - Get earn tokens from MongoDB
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { type, buildNumber } = req.query;
    const typeFilter = type && typeof type === 'string' ? { type } : undefined;
    let tokens = await dbManager.getTokens(typeFilter);

    // Hide vaults that require a newer app build than the client is running.
    // Vaults with no `minAppBuild` are always visible.
    const build = typeof buildNumber === 'string' ? parseInt(buildNumber, 10) : 0;
    tokens = tokens.filter((t: any) => !t.minAppBuild || build >= t.minAppBuild);

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
const perenaManager = new PerenaManager();

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
    if (!walletAddress || typeof walletAddress !== 'string' || !isValidSolanaAddress(walletAddress)) {
      res.status(400).json({ success: false, error: 'Valid walletAddress query param is required' });
      return;
    }

    // IDOR protection: verify the wallet belongs to the authenticated user
    if (!(await verifyWalletOwnership(req, walletAddress))) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    const positionPromises: [string, Promise<any[]>][] = [
      ['jupiter', jupiterManager.getWalletPositions(walletAddress)],
      ['kamino', kaminoManager.getWalletPositions(walletAddress)],
      ['perena', perenaManager.getWalletPositions(walletAddress)],
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
      ...(settled.perena ?? []).map((p: any) => {
        const tokenInfo = SUPPORTED_TOKENS_BY_MINT[p.mint];
        const decimals = tokenInfo?.decimals ?? 0;
        const symbol = tokenInfo?.symbol ?? '';
        const uiAmount = Number(p.amount) / 10 ** decimals;
        return {
          type: EarnTokenType.PERENA,
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
    if (!walletAddress || typeof walletAddress !== 'string' || !isValidSolanaAddress(walletAddress)) {
      res.status(400).json({ success: false, error: 'Valid walletAddress query param is required' });
      return;
    }

    // IDOR protection: verify the wallet belongs to the authenticated user
    if (!(await verifyWalletOwnership(req, walletAddress))) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    // Fetch cost basis records and current positions in parallel
    const [costBasisRecords, positionsRes] = await Promise.all([
      UserCostBasisModel.find({ vaultAddress: walletAddress }).lean(),
      // Re-use the positions logic: fetch from all protocols
      (async () => {
        const positionPromises: [string, Promise<any[]>][] = [
          ['jupiter', jupiterManager.getWalletPositions(walletAddress)],
          ['kamino', kaminoManager.getWalletPositions(walletAddress)],
          ['perena', perenaManager.getWalletPositions(walletAddress)],
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
    for (const p of (positionsRes.perena ?? [])) {
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
      const currentPosition = currentPositionByMint[mint]?.amount ?? 0n;

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

// POST /earn/v1/deposit - Get unsigned deposit transaction (or raw instructions)
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { type, mint, vaultAddress, amount, walletAddress, ownerAddress, returnInstructions } = req.body;
    const authority = ownerAddress || walletAddress;
    // The user's Squads vault PDA — used as the owner key for Transaction
    // records and cost basis. `vaultAddress` (req.body) is the *protocol*
    // pool vault (Jupiter Lend pool, Kamino vault, etc.) and is only used
    // server-side for protocol lookups / instruction building.
    const userVault = (req as AuthenticatedRequest).user?.vaultAddress || ownerAddress || walletAddress;

    const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
    console.log(`DEPOSIT walletAddress: ${walletAddress}, ownerAddress: ${authority}, type: ${type}, mint: ${mint}, symbol: ${tokenInfo?.symbol}, amount (raw): ${amount}, decimals: ${tokenInfo?.decimals}, vaultAddress: ${vaultAddress}, returnInstructions: ${!!returnInstructions}`)

    // Validate minimum deposit amount (use > to require strictly above minimum —
    // Kamino rounds internally so exact-minimum deposits can fail onchain)
    const earnToken = await EarnTokenModel.findOne({ type, mint, vaultAddress, status: 'active' }).lean();
    if (earnToken?.minDepositAmount && earnToken.minDepositAmount !== '0' && BigInt(amount) <= BigInt(earnToken.minDepositAmount)) {
      const decimals = tokenInfo?.decimals ?? 0;
      const minUi = (Number(earnToken.minDepositAmount) / 10 ** decimals).toString();
      res.status(400).json({ success: false, error: `Minimum deposit is more than ${minUi} ${tokenInfo?.symbol ?? ''}` });
      return;
    }

    // Return raw instructions for Squads vault flow
    if (returnInstructions) {
      let instructions: any[];
      let perenaLookupTables: string[] = [];
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
        case EarnTokenType.PERENA: {
          const perenaRes = await perenaManager.getDepositInstructions(vaultAddress, amount, authority);
          instructions = perenaRes.instructions;
          perenaLookupTables = perenaRes.lookupTables;
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

      // Collect extra LUTs (e.g. Kamino vault-specific lookup table, Perena bankineco LUTs)
      const extraLookupTables: string[] = [];
      if (type === EarnTokenType.KAMINO && vaultAddress) {
        const vaultDoc = await EarnTokenModel.findOne({ type, vaultAddress }).lean();
        const vaultLut = vaultDoc?.kaminoToken?.state?.vaultLookupTable;
        if (vaultLut) extraLookupTables.push(vaultLut);
      }
      if (perenaLookupTables && perenaLookupTables.length > 0) {
        extraLookupTables.push(...perenaLookupTables);
      }

      const record = await dbManager.createTransaction({
        action: TransactionAction.DEPOSIT,
        type,
        mint,
        vaultAddress,
        userVaultAddress: userVault,
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
      case EarnTokenType.PERENA:
        transaction = await perenaManager.deposit(vaultAddress, amount, walletAddress);
        break;
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    const record = await dbManager.createTransaction({
      action: TransactionAction.DEPOSIT,
      type,
      mint,
      vaultAddress,
      userVaultAddress: userVault,
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
    // User's Squads vault — see deposit route for explanation.
    const userVault = (req as AuthenticatedRequest).user?.vaultAddress || ownerAddress || walletAddress;

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
      let perenaLookupTables: string[] = [];
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
        case EarnTokenType.PERENA: {
          const perenaRes = await perenaManager.getWithdrawInstructions(vaultAddress, amount, authority);
          instructions = perenaRes.instructions;
          perenaLookupTables = perenaRes.lookupTables;
          break;
        }
        default:
          res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
          return;
      }

      // Collect extra LUTs (e.g. Kamino vault-specific lookup table, Perena bankineco LUTs)
      const extraLookupTables: string[] = [];
      if (type === EarnTokenType.KAMINO && vaultAddress) {
        const vaultDoc = await EarnTokenModel.findOne({ type, vaultAddress }).lean();
        const vaultLut = vaultDoc?.kaminoToken?.state?.vaultLookupTable;
        if (vaultLut) extraLookupTables.push(vaultLut);
      }
      if (perenaLookupTables.length > 0) {
        extraLookupTables.push(...perenaLookupTables);
      }

      const record = await dbManager.createTransaction({
        action: TransactionAction.WITHDRAW,
        type,
        mint,
        vaultAddress,
        userVaultAddress: userVault,
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
      case EarnTokenType.PERENA:
        transaction = await perenaManager.withdraw(vaultAddress, amount, walletAddress);
        break;
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    const record = await dbManager.createTransaction({
      action: TransactionAction.WITHDRAW,
      type,
      mint,
      vaultAddress,
      userVaultAddress: userVault,
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

// POST /earn/v1/notify-interest - Record user interest in a view-only protocol
router.post('/notify-interest', async (req: Request, res: Response) => {
  try {
    const { protocol, protocolName } = req.body;
    if (!protocol || typeof protocol !== 'string') {
      res.status(400).json({ success: false, error: 'protocol is required' });
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;
    const vaultAddress = authReq.user?.vaultAddress;
    if (!userId || !vaultAddress) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    await NotifyInterestModel.updateOne(
      { userId, protocol },
      { $set: { userId, protocol, protocolName } },
      { upsert: true },
    );

    notifyAdmin(
      `🔔 User wants to deposit into <b>${protocolName || protocol}</b> (view-only)\n\nVault: <code>${vaultAddress}</code>`,
    ).catch(() => {});

    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error recording notify interest:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record interest',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
