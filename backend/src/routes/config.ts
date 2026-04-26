import { Router, Request, Response } from 'express';
import { LookupManager } from '../managers/LookupManager';
import { createVaultCreationFeeRecord } from '../services/feeService';
import { VAULT_CREATION_FEE } from '../constants';
import { getAdminTxFeePayerPublicKeyBase58 } from '../services/adminFeePayer';
import { getSetting, APP_SETTING_KEYS } from '../models/AppSetting';

const router = Router();

// GET /config/v1 - App configuration for mobile clients
router.get('/', async (req: Request, res: Response) => {
  const rewardsCollectionAddress = await getSetting(
    APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS,
    process.env.REWARDS_COLLECTION_ADDRESS ?? null,
  );
  res.json({
    success: true,
    data: {
      lookupTableAddress: LookupManager.lookupTableAddress ?? null,
      solanaRpcUrl: process.env.MOBILE_SOLANA_RPC ?? null,
      treasuryWallet: process.env.TREASURY_WALLET_ADDRESS ?? null,
      vaultCreationFee: VAULT_CREATION_FEE,
      supportUrl: process.env.SUPPORT_URL ?? 'https://t.me/mike_cashflow',
      adminTxFeePayerPublicKey: getAdminTxFeePayerPublicKeyBase58(),
      rewardsCollectionAddress,
      rewardsBadgeMintFeeLamports: 20_000_000,
    },
  });
});

// POST /config/v1/vault-creation-fee - Record a vault creation fee payment
router.post('/vault-creation-fee', async (req: Request, res: Response) => {
  try {
    const { vaultAddress, feeAmount, signature } = req.body;
    if (!vaultAddress || !feeAmount || !signature) {
      res.status(400).json({ success: false, error: 'vaultAddress, feeAmount, and signature are required' });
      return;
    }

    await createVaultCreationFeeRecord({ vaultAddress, feeAmount, signature });
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording vault creation fee:', error);
    res.status(500).json({ success: false, error: 'Failed to record vault creation fee' });
  }
});

export default router;
