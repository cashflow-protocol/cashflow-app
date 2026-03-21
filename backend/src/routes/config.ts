import { Router, Request, Response } from 'express';
import { LookupManager } from '../managers/LookupManager';
import { createVaultCreationFeeRecord } from '../services/feeService';

const router = Router();

// GET /config/v1 - App configuration for mobile clients
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      lookupTableAddress: LookupManager.lookupTableAddress ?? null,
      solanaRpcUrl: process.env.MOBILE_SOLANA_RPC ?? null,
      treasuryWallet: process.env.TREASURY_WALLET_ADDRESS ?? null,
    },
  });
});

// POST /config/v1/vault-creation-fee - Record a vault creation fee payment
router.post('/vault-creation-fee', async (req: Request, res: Response) => {
  try {
    const { walletAddress, feeAmount, signature } = req.body;
    if (!walletAddress || !feeAmount || !signature) {
      res.status(400).json({ success: false, error: 'walletAddress, feeAmount, and signature are required' });
      return;
    }

    await createVaultCreationFeeRecord({ walletAddress, feeAmount, signature });
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording vault creation fee:', error);
    res.status(500).json({ success: false, error: 'Failed to record vault creation fee' });
  }
});

export default router;
