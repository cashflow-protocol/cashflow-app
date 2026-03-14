import { Router } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { InviteCodeModel, WaitlistUserModel, WaitlistTaskModel } from '../models';

const router = Router();

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const pendingEmailCodes = new Map<string, { code: string; expiresAt: number }>();

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY is required');
  return new BrevoClient({ apiKey });
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /validate-invite
 * Check if an invite code is valid and available.
 */
router.post('/validate-invite', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ success: false, error: 'code is required' });
      return;
    }

    const invite = await InviteCodeModel.findOne({ code: code.toUpperCase() });
    const valid = invite !== null && !invite.used;

    res.json({ success: true, valid });
  } catch (error) {
    console.error('Validate invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to validate invite code' });
  }
});

/**
 * POST /redeem-invite
 * Mark an invite code as used by a public key.
 */
router.post('/redeem-invite', async (req, res) => {
  try {
    const { code, publicKey } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ success: false, error: 'code is required' });
      return;
    }
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const invite = await InviteCodeModel.findOneAndUpdate(
      { code: code.toUpperCase(), used: false },
      { $set: { used: true, usedBy: publicKey, usedAt: new Date() } },
      { new: true },
    );

    if (!invite) {
      res.status(400).json({ success: false, error: 'Invalid or already used invite code' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Redeem invite error:', error);
    res.status(500).json({ success: false, error: 'Failed to redeem invite code' });
  }
});

// ─── Waitlist endpoints ───

/**
 * POST /waitlist/register
 * Register a new waitlist user by public key.
 */
router.post('/waitlist/register', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      { $setOnInsert: { publicKey, xp: 0, status: 'waiting', completedTasks: [] } },
      { upsert: true },
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Waitlist register error:', error);
    res.status(500).json({ success: false, error: 'Failed to register' });
  }
});

/**
 * POST /waitlist/tasks
 * Get all active tasks with completion status for a user.
 */
router.post('/waitlist/tasks', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const [tasks, user, rank] = await Promise.all([
      WaitlistTaskModel.find({ active: true }).sort({ sortOrder: 1 }).lean(),
      WaitlistUserModel.findOne({ publicKey }).lean(),
      WaitlistUserModel.countDocuments({
        status: 'waiting',
        xp: { $gt: (await WaitlistUserModel.findOne({ publicKey }).lean())?.xp ?? 0 },
      }),
    ]);

    const completedSet = new Set(user?.completedTasks ?? []);

    const taskList = tasks.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      description: t.description,
      xpReward: t.xpReward,
      category: t.category,
      requiresTask: t.requiresTask,
      metadata: t.metadata,
      completed: completedSet.has(t.taskId),
      locked: t.requiresTask ? !completedSet.has(t.requiresTask) : false,
    }));

    res.json({
      success: true,
      tasks: taskList,
      xp: user?.xp ?? 0,
      rank: rank + 1,
    });
  } catch (error) {
    console.error('Waitlist tasks error:', error);
    res.status(500).json({ success: false, error: 'Failed to get tasks' });
  }
});

/**
 * POST /waitlist/check-status
 * Check if a waitlist user has been approved.
 */
router.post('/waitlist/check-status', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const user = await WaitlistUserModel.findOne({ publicKey }).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      approved: user.status === 'approved',
      inviteCode: user.status === 'approved' ? user.inviteCode : undefined,
    });
  } catch (error) {
    console.error('Waitlist check-status error:', error);
    res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

/**
 * GET /waitlist/leaderboard
 * Get top 20 waitlist users and the requesting user's rank.
 */
router.get('/waitlist/leaderboard', async (req, res) => {
  try {
    const publicKey = req.query.publicKey as string | undefined;

    const top = await WaitlistUserModel.find({ status: 'waiting' })
      .sort({ xp: -1 })
      .limit(20)
      .lean();

    const leaderboard = top.map((u, i) => ({
      rank: i + 1,
      xp: u.xp,
      publicKey: u.publicKey.slice(0, 4) + '...' + u.publicKey.slice(-4),
    }));

    let userRank: number | null = null;
    let userXp: number | null = null;

    if (publicKey) {
      const user = await WaitlistUserModel.findOne({ publicKey }).lean();
      if (user) {
        userXp = user.xp;
        const above = await WaitlistUserModel.countDocuments({
          status: 'waiting',
          xp: { $gt: user.xp },
        });
        userRank = above + 1;
      }
    }

    res.json({ success: true, leaderboard, userRank, userXp });
  } catch (error) {
    console.error('Waitlist leaderboard error:', error);
    res.status(500).json({ success: false, error: 'Failed to get leaderboard' });
  }
});

// ─── Email verification ───

/**
 * POST /waitlist/connect-email/send-code
 * Send a verification code to the user's email.
 */
router.post('/waitlist/connect-email/send-code', async (req, res) => {
  try {
    const { publicKey, email } = req.body;
    if (!publicKey || !email) {
      res.status(400).json({ success: false, error: 'publicKey and email are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const code = generateCode();
    pendingEmailCodes.set(`${publicKey}:${normalizedEmail}`, { code, expiresAt: Date.now() + CODE_EXPIRY_MS });

    const brevo = getBrevoClient();
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: 'Cashflow', email: 'hello@cashflow.fun' },
      to: [{ email: normalizedEmail }],
      subject: 'Your Cashflow verification code',
      htmlContent: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #000; margin-bottom: 8px;">Verify your email</h2>
          <p style="color: #666; margin-bottom: 32px;">Use this code to connect your email on Cashflow:</p>
          <div style="background: #f4f6fc; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #175DA3;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Waitlist send-code error:', error);
    res.status(500).json({ success: false, error: 'Failed to send code' });
  }
});

/**
 * POST /waitlist/connect-email/verify
 * Verify email code, award XP, mark task complete.
 */
router.post('/waitlist/connect-email/verify', async (req, res) => {
  try {
    const { publicKey, email, code } = req.body;
    if (!publicKey || !email || !code) {
      res.status(400).json({ success: false, error: 'publicKey, email, and code are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const key = `${publicKey}:${normalizedEmail}`;
    const pending = pendingEmailCodes.get(key);

    if (!pending) {
      res.status(400).json({ success: false, error: 'No verification code found. Please request a new one.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingEmailCodes.delete(key);
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (pending.code !== code.trim()) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    pendingEmailCodes.delete(key);

    // Find the task to get XP reward
    const task = await WaitlistTaskModel.findOne({ taskId: 'connect_email' }).lean();
    const xpReward = task?.xpReward ?? 100;

    // Update user: save email, mark task complete, award XP
    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      {
        $set: { email: normalizedEmail, emailVerified: true },
        $addToSet: { completedTasks: 'connect_email' },
        $inc: { xp: xpReward },
      },
    );

    res.json({ success: true, xpAwarded: xpReward });
  } catch (error) {
    console.error('Waitlist verify-email error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

export default router;
