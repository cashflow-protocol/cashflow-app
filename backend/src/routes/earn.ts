import { Router, Request, Response } from 'express';

const router = Router();

// GET /earn/v1/tokens - Returns empty list for now
router.get('/tokens', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
    timestamp: new Date().toISOString()
  });
});

export default router;
