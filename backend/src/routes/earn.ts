import { Router, Request, Response } from 'express';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';

const router = Router();

// GET /earn/v1/tokens - Get earn tokens from MongoDB
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    // Build query filter
    const filter: any = {};
    if (type && typeof type === 'string') {
      filter.type = type;
    }

    // Fetch tokens from MongoDB
    const dbTokens = await EarnTokenModel.find(filter)
      .select('type mint vaultAddress vaultTitle symbol rewardsRate')
      .sort({ symbol: 1 })
      .lean();

    // Merge DB data with static token info from constants (excluding logoUrl)
    const tokens = dbTokens.map(({ _id, ...token }) => {
      const { logoUrl, ...tokenInfo } = SUPPORTED_TOKENS_BY_MINT[token.mint] ?? {};
      return { ...token, ...tokenInfo };
    });

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

export default router;
