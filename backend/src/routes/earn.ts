import { Router, Request, Response } from 'express';
import { JupiterManager } from '../managers';

const router = Router();
const jupiterManager = new JupiterManager();

// GET /earn/v1/tokens - Get earn tokens from Jupiter Lend API
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const tokens = await jupiterManager.getEarnTokens();

    res.json({
      success: true,
      data: tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching earn tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch earn tokens',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
