import { Router } from 'express';
import { createRecoveryWallet } from '../services/privyService';

const router = Router();

/**
 * POST /create-wallet
 * Called after Privy client-side email verification succeeds.
 * Creates a server-owned Privy wallet for recovery and returns the Solana address.
 */
router.post('/create-wallet', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Create server-owned Privy wallet for recovery
    const { solanaAddress } = await createRecoveryWallet(normalizedEmail);

    if (!solanaAddress) {
      res.status(500).json({ success: false, error: 'Failed to create recovery wallet' });
      return;
    }

    res.json({
      success: true,
      data: { solanaAddress },
    });
  } catch (error) {
    console.error('Recovery create-wallet error:', error);
    res.status(500).json({ success: false, error: 'Failed to create recovery wallet' });
  }
});

export default router;
