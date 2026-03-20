import { Router } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { getOrCreatePrivyUser } from '../services/privyService';

const router = Router();

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const pendingRecoveryCodes = new Map<string, { code: string; expiresAt: number }>();

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY is required');
  return new BrevoClient({ apiKey });
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /send-code
 * Send a verification code to the recovery email.
 */
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const code = generateCode();
    pendingRecoveryCodes.set(normalizedEmail, { code, expiresAt: Date.now() + CODE_EXPIRY_MS });

    const brevo = getBrevoClient();
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: 'Cashflow', email: 'hello@cashflow.fun' },
      to: [{ email: normalizedEmail }],
      subject: 'Your Cashflow recovery key verification code',
      htmlContent: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #000; margin-bottom: 8px;">Recovery Key Verification</h2>
          <p style="color: #666; margin-bottom: 32px;">Use this code to add your email as a recovery key on Cashflow:</p>
          <div style="background: #f4f6fc; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #19C394;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Recovery send-code error:', error);
    res.status(500).json({ success: false, error: 'Failed to send code' });
  }
});

/**
 * POST /verify
 * Verify email code, create Privy embedded wallet, return Solana public key.
 */
router.post('/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ success: false, error: 'email and code are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = pendingRecoveryCodes.get(normalizedEmail);

    if (!pending) {
      res.status(400).json({ success: false, error: 'No verification code found. Please request a new one.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingRecoveryCodes.delete(normalizedEmail);
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (pending.code !== code) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    // Code verified — clean up
    pendingRecoveryCodes.delete(normalizedEmail);

    // Create or get Privy user with embedded Solana wallet
    const { solanaAddress } = await getOrCreatePrivyUser(normalizedEmail);

    if (!solanaAddress) {
      res.status(500).json({ success: false, error: 'Failed to create recovery wallet' });
      return;
    }

    res.json({
      success: true,
      data: { solanaAddress },
    });
  } catch (error) {
    console.error('Recovery verify error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify code' });
  }
});

export default router;
