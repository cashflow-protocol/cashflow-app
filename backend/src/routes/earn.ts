import { Router, Request, Response } from 'express';
import { EarnTokenModel } from '../models';
import { JupiterManager } from '../managers';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import type { IBalance } from '../types';

const router = Router();

// GET /earn/v1/tokens - Get earn tokens from MongoDB
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    // Build query filter
    const filter: any = { status: 'active' };
    if (type && typeof type === 'string') {
      filter.type = type;
    }

    // Fetch tokens from MongoDB
    const tokens = await EarnTokenModel.find(filter)
      .select('type mint vaultAddress vaultTitle symbol rewardsRate status')
      .sort({ symbol: 1 });

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

// GET /earn/v1/positions/:wallet - Get wallet positions across protocols
const jupiterManager = new JupiterManager();

router.get('/positions', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress query param is required' });
      return;
    }
    const jupiterPositions = await jupiterManager.getWalletPositions(walletAddress);

    const positions = jupiterPositions
      .filter((p) => Number(p.underlyingAssets) > 0)
      .map((p) => {
        const mint = p.token.assetAddress;
        const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
        const decimals = tokenInfo?.decimals ?? 0;
        return {
          type: 'jupiter',
          mint,
          symbol: tokenInfo?.symbol ?? '',
          balance: {
            amount: p.underlyingAssets,
            decimals,
            uiAmount: Number(p.underlyingAssets) / 10 ** decimals,
          } as IBalance,
        };
      });

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

// POST /earn/v1/deposit - Get unsigned deposit transaction
router.post('/deposit', async (req: Request, res: Response) => {
  try {
    const { type, mint, vaultAddress, amount, walletAddress } = req.body;

    let transaction: string;
    switch (type) {
      case 'jupiter':
        transaction = await jupiterManager.deposit(mint, amount, walletAddress);
        break;
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    res.json({
      success: true,
      transaction,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating deposit transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create deposit transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /earn/v1/withdraw - Get unsigned withdraw transaction
router.post('/withdraw', async (req: Request, res: Response) => {
  try {
    const { type, mint, vaultAddress, amount, walletAddress } = req.body;

    let transaction: string;
    switch (type) {
      case 'jupiter':
        transaction = await jupiterManager.withdraw(mint, amount, walletAddress);
        break;
      default:
        res.status(400).json({ success: false, error: `Unsupported type: ${type}` });
        return;
    }

    res.json({
      success: true,
      transaction,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating withdraw transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create withdraw transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
