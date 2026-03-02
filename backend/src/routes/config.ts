import { Router, Request, Response } from 'express';
import { LookupManager } from '../managers/LookupManager';

const router = Router();

// GET /config/v1 - App configuration for mobile clients
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      lookupTableAddress: LookupManager.lookupTableAddress ?? null,
    },
  });
});

export default router;
