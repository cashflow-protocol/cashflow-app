import { Router, Request, Response } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { WaitlistEntryModel } from '../models';

const router = Router();

const BREVO_LIST_ID = 14;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory store for verification codes (email -> { code, expiresAt })
const pendingCodes = new Map<string, { code: string; expiresAt: number }>();

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY is required');
  return new BrevoClient({ apiKey });
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /waitlist/v1/send-code
router.post('/send-code', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if already on waitlist
    const existing = await WaitlistEntryModel.findOne({ email: normalizedEmail, verified: true });
    if (existing) {
      res.json({ success: true, message: 'Already on waitlist' });
      return;
    }

    const code = generateCode();
    pendingCodes.set(normalizedEmail, { code, expiresAt: Date.now() + CODE_EXPIRY_MS });

    const brevo = getBrevoClient();
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: 'Cashflow', email: 'hello@cashflow.fun' },
      to: [{ email: normalizedEmail }],
      subject: 'Your Cashflow verification code',
      htmlContent: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #000; margin-bottom: 8px;">Verify your email</h2>
          <p style="color: #666; margin-bottom: 32px;">Use this code to join the Cashflow waitlist:</p>
          <div style="background: #f4f6fc; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #175DA3;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('[waitlist] send-code error:', error);
    res.status(500).json({ success: false, error: 'Failed to send verification code' });
  }
});

// POST /waitlist/v1/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ success: false, error: 'Email and code are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = pendingCodes.get(normalizedEmail);

    if (!pending) {
      res.status(400).json({ success: false, error: 'No verification code found. Please request a new one.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingCodes.delete(normalizedEmail);
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (pending.code !== code.trim()) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    // Code is valid — clean up
    pendingCodes.delete(normalizedEmail);

    // Save to MongoDB
    await WaitlistEntryModel.findOneAndUpdate(
      { email: normalizedEmail },
      { email: normalizedEmail, verified: true },
      { upsert: true },
    );

    // Add to Brevo list
    try {
      const brevo = getBrevoClient();
      await brevo.contacts.createContact({
        email: normalizedEmail,
        listIds: [BREVO_LIST_ID],
        updateEnabled: true,
      });
    } catch (brevoError) {
      console.error('[waitlist] Brevo contact creation error:', brevoError);
      // Don't fail the request — email is already saved to MongoDB
    }

    res.json({ success: true, message: 'Email verified! You\'re on the waitlist.' });
  } catch (error) {
    console.error('[waitlist] verify error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

export default router;
