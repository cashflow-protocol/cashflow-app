import crypto from 'crypto';
import { Router } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { InviteCodeModel, WaitlistUserModel, WaitlistTaskModel } from '../models';
import multer from 'multer';
import * as socialAuth from '../services/socialAuth';
import * as telegram from '../services/telegramManager';
import * as storage from '../services/storageManager';

const router = Router();

const BREVO_WAITLIST_LIST_ID = 14;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const pendingEmailCodes = new Map<string, { code: string; expiresAt: number }>();

// OAuth pending states: state → { publicKey, codeVerifier?, provider, expiresAt }
interface OAuthPendingState {
  publicKey: string;
  codeVerifier?: string;
  provider: 'twitter' | 'discord';
  expiresAt: number;
}
const pendingOAuthStates = new Map<string, OAuthPendingState>();

// Telegram pending codes: code → { publicKey, expiresAt }
const pendingTelegramCodes = new Map<string, { publicKey: string; expiresAt: number }>();

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
    const valid = invite !== null && invite.useCount < invite.maxUses;

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
      { code: code.toUpperCase(), $expr: { $lt: ['$useCount', '$maxUses'] } },
      { $inc: { useCount: 1 }, $push: { usedBy: { publicKey, usedAt: new Date() } } },
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

    const existing = await WaitlistUserModel.findOne({ publicKey });
    if (!existing) {
      await WaitlistUserModel.create({ publicKey, xp: 0, status: 'waiting', completedTasks: [] });
      const total = await WaitlistUserModel.countDocuments();
      telegram.notifyAdmin(`🆕 New waitlist signup!\n\nWallet: <code>${publicKey.slice(0, 6)}...${publicKey.slice(-4)}</code>\nTotal waitlist: ${total}`);
    }

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

    const [tasks, user] = await Promise.all([
      WaitlistTaskModel.find({ active: true }).sort({ sortOrder: 1 }).lean(),
      WaitlistUserModel.findOne({ publicKey }).lean(),
    ]);

    const userXp = user?.xp ?? 0;
    const userLastXpAt = user?.lastXpAt ?? new Date();
    const rank = await WaitlistUserModel.countDocuments({
      status: 'waiting',
      $or: [
        { xp: { $gt: userXp } },
        { xp: userXp, lastXpAt: { $lt: userLastXpAt } },
      ],
    });

    const completedSet = new Set(user?.completedTasks ?? []);

    const taskList = tasks
      .map((t, i) => ({
        taskId: t.taskId,
        title: t.title,
        description: t.description,
        xpReward: t.xpReward,
        category: t.category,
        requiresTask: t.requiresTask,
        metadata: t.metadata,
        completed: completedSet.has(t.taskId),
        locked: t.requiresTask ? !completedSet.has(t.requiresTask) : false,
        _sortOrder: i,
      }))
      .sort((a, b) => {
        const group = (t: typeof a) => t.completed ? 0 : t.locked ? 2 : 1;
        const diff = group(a) - group(b);
        return diff !== 0 ? diff : a._sortOrder - b._sortOrder;
      })
      .map(({ _sortOrder, ...t }) => t);

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
      .sort({ xp: -1, lastXpAt: 1 })
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
          $or: [
            { xp: { $gt: user.xp } },
            { xp: user.xp, lastXpAt: { $lt: user.lastXpAt ?? new Date() } },
          ],
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

    // Update user: save email, mark task complete, award XP (only if not already completed)
    await WaitlistUserModel.findOneAndUpdate(
      { publicKey, completedTasks: { $ne: 'connect_email' } },
      {
        $set: { email: normalizedEmail, emailVerified: true },
        $addToSet: { completedTasks: 'connect_email' },
        $inc: { xp: xpReward },
      },
    );

    // Add to Brevo "Cashflow Waitlist" list
    try {
      const brevo = getBrevoClient();
      await brevo.contacts.createContact({
        email: normalizedEmail,
        listIds: [BREVO_WAITLIST_LIST_ID],
        updateEnabled: true,
      });
    } catch (brevoError) {
      console.error('Brevo contact creation error:', brevoError);
      // Don't fail the request — email is already saved to MongoDB
    }

    res.json({ success: true, xpAwarded: xpReward });
  } catch (error) {
    console.error('Waitlist verify-email error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// ─── Helper: award XP for a task (prevents double award) ───

async function awardTaskXp(publicKey: string, taskId: string, extraFields?: Record<string, any>) {
  const task = await WaitlistTaskModel.findOne({ taskId }).lean();
  const xpReward = task?.xpReward ?? 100;

  const result = await WaitlistUserModel.findOneAndUpdate(
    { publicKey, completedTasks: { $ne: taskId } },
    {
      $addToSet: { completedTasks: taskId },
      $inc: { xp: xpReward },
      $set: { lastXpAt: new Date(), ...extraFields },
    },
    { new: true },
  );

  if (result) {
    const parts = [`✅ Task completed: <b>${task?.title ?? taskId}</b> (+${xpReward} XP)`];
    parts.push(`\nTotal XP: ${result.xp} | Tasks: ${result.completedTasks.length}`);
    parts.push(`Wallet: <code>${publicKey.slice(0, 6)}...${publicKey.slice(-4)}</code>`);
    if (result.email) parts.push(`Email: ${result.email}`);
    if (result.twitterHandle) parts.push(`X: @${result.twitterHandle}`);
    if (result.discordUsername) parts.push(`Discord: ${result.discordUsername}`);
    if (result.telegramUsername) parts.push(`Telegram: @${result.telegramUsername}`);
    if (result.walletAddress) parts.push(`Solana: <code>${result.walletAddress.slice(0, 6)}...${result.walletAddress.slice(-4)}</code>`);
    telegram.notifyAdmin(parts.join('\n'));
  }

  return { awarded: result !== null, xpReward };
}

// ─── Wallet connect ───

/**
 * POST /waitlist/connect-wallet
 * Save the user's Solana wallet address and award XP.
 */
router.post('/waitlist/connect-wallet', async (req, res) => {
  try {
    const { publicKey, walletAddress } = req.body;
    if (!publicKey || !walletAddress) {
      res.status(400).json({ success: false, error: 'publicKey and walletAddress are required' });
      return;
    }

    const { awarded, xpReward } = await awardTaskXp(publicKey, 'connect_wallet', {
      walletAddress,
    });

    res.json({ success: true, xpAwarded: awarded ? xpReward : 0 });
  } catch (error) {
    console.error('Connect wallet error:', error);
    res.status(500).json({ success: false, error: 'Failed to connect wallet' });
  }
});

// ─── Twitter/X OAuth ───

/**
 * POST /waitlist/connect-x/start
 * Generate Twitter OAuth URL for the user.
 */
router.post('/waitlist/connect-x/start', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = socialAuth.generateCodeVerifier();
    const authUrl = socialAuth.generateTwitterOAuthUrl(state, codeVerifier);

    if (!authUrl) {
      res.status(503).json({ success: false, error: 'Twitter integration not configured' });
      return;
    }

    pendingOAuthStates.set(state, {
      publicKey,
      codeVerifier,
      provider: 'twitter',
      expiresAt: Date.now() + CODE_EXPIRY_MS,
    });

    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('Connect X start error:', error);
    res.status(500).json({ success: false, error: 'Failed to start Twitter auth' });
  }
});

/**
 * GET /waitlist/connect-x/callback
 * Twitter OAuth callback — browser redirect.
 */
router.get('/waitlist/connect-x/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }

    const pending = pendingOAuthStates.get(state);
    if (!pending || pending.provider !== 'twitter' || Date.now() > pending.expiresAt) {
      res.status(400).send('Invalid or expired OAuth state');
      return;
    }
    pendingOAuthStates.delete(state);

    const twitterUser = await socialAuth.exchangeTwitterCode(code, pending.codeVerifier!);
    if (!twitterUser) {
      res.status(500).send('Failed to exchange Twitter code');
      return;
    }

    await awardTaskXp(pending.publicKey, 'connect_x', {
      twitterId: twitterUser.id,
      twitterHandle: twitterUser.username,
      twitterAccessToken: twitterUser.accessToken,
    });

    res.redirect('cashflow://oauth/callback?provider=x&success=true');
  } catch (error) {
    console.error('Connect X callback error:', error);
    res.redirect('cashflow://oauth/callback?provider=x&success=false');
  }
});

// ─── Discord OAuth ───

/**
 * POST /waitlist/connect-discord/start
 * Generate Discord OAuth URL for the user.
 */
router.post('/waitlist/connect-discord/start', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = socialAuth.generateDiscordOAuthUrl(state);

    if (!authUrl) {
      res.status(503).json({ success: false, error: 'Discord integration not configured' });
      return;
    }

    pendingOAuthStates.set(state, {
      publicKey,
      provider: 'discord',
      expiresAt: Date.now() + CODE_EXPIRY_MS,
    });

    res.json({ success: true, authUrl });
  } catch (error) {
    console.error('Connect Discord start error:', error);
    res.status(500).json({ success: false, error: 'Failed to start Discord auth' });
  }
});

/**
 * GET /waitlist/connect-discord/callback
 * Discord OAuth callback — browser redirect.
 */
router.get('/waitlist/connect-discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }

    const pending = pendingOAuthStates.get(state);
    if (!pending || pending.provider !== 'discord' || Date.now() > pending.expiresAt) {
      res.status(400).send('Invalid or expired OAuth state');
      return;
    }
    pendingOAuthStates.delete(state);

    const discordUser = await socialAuth.exchangeDiscordCode(code);
    if (!discordUser) {
      res.status(500).send('Failed to exchange Discord code');
      return;
    }

    await awardTaskXp(pending.publicKey, 'connect_discord', {
      discordId: discordUser.id,
      discordUsername: discordUser.username,
    });

    res.redirect('cashflow://oauth/callback?provider=discord&success=true');
  } catch (error) {
    console.error('Connect Discord callback error:', error);
    res.redirect('cashflow://oauth/callback?provider=discord&success=false');
  }
});

// ─── Telegram (bot-code approach) ───

/**
 * POST /waitlist/connect-telegram/start
 * Generate a code for the user to send to the Telegram bot.
 */
router.post('/waitlist/connect-telegram/start', async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    if (!telegram.isConfigured()) {
      res.status(503).json({ success: false, error: 'Telegram integration not configured' });
      return;
    }

    const code = generateCode();
    pendingTelegramCodes.set(code, { publicKey, expiresAt: Date.now() + CODE_EXPIRY_MS });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'CashflowBot';
    res.json({ success: true, code, botUrl: `https://t.me/${botUsername}` });
  } catch (error) {
    console.error('Connect Telegram start error:', error);
    res.status(500).json({ success: false, error: 'Failed to start Telegram connection' });
  }
});

/**
 * POST /waitlist/telegram-webhook
 * Telegram bot webhook — receives messages from users.
 */
router.post('/waitlist/telegram-webhook', async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message?.text || !message?.from) {
      res.json({ ok: true });
      return;
    }

    // Handle /start without code — welcome message
    const rawText = message.text.trim();
    if (rawText === '/start') {
      await telegram.sendMessage(
        message.from.id.toString(),
        '👋 Welcome to cashflow.fun bot!\n\nTo link your Telegram account just send the verification code here.\n\nThat\'s it!',
      );
      res.json({ ok: true });
      return;
    }

    // Handle both raw code and /start CODE (Telegram deep link sends "/start CODE")
    const code = rawText.startsWith('/start ') ? rawText.slice(7).trim() : rawText;
    const pending = pendingTelegramCodes.get(code);

    if (!pending || Date.now() > pending.expiresAt) {
      await telegram.sendMessage(
        message.from.id.toString(),
        pending ? 'This code has expired. Please request a new one in the app.' : 'Invalid code. Please get a code from the Cashflow app first.',
      );
      res.json({ ok: true });
      return;
    }

    pendingTelegramCodes.delete(code);

    await awardTaskXp(pending.publicKey, 'connect_telegram', {
      telegramId: message.from.id.toString(),
      telegramUsername: message.from.username || '',
    });

    await telegram.sendMessage(
      message.from.id.toString(),
      'Telegram connected! You can now return to the Cashflow app.',
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.json({ ok: true }); // Always 200 for Telegram
  }
});

// ─── Screenshot upload (dApp Store rating proof) ───

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

router.post('/waitlist/upload-screenshot', upload.single('image'), async (req, res) => {
  try {
    const { publicKey, taskId } = req.body;
    if (!publicKey || !taskId) {
      res.status(400).json({ success: false, error: 'publicKey and taskId are required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, error: 'Image file is required' });
      return;
    }

    if (!storage.isConfigured()) {
      res.status(500).json({ success: false, error: 'Storage is not configured' });
      return;
    }

    // Upload to DO Spaces
    const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `screenshots/${publicKey}/${taskId}_${Date.now()}.${ext}`;
    const imageUrl = await storage.uploadFile(req.file.buffer, key, req.file.mimetype);

    // Save screenshot reference
    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      { $push: { proofScreenshots: { taskId, imageUrl, uploadedAt: new Date() } } },
    );

    // Auto-approve: award XP
    const { awarded, xpReward } = await awardTaskXp(publicKey, taskId);

    res.json({ success: true, xpAwarded: awarded ? xpReward : 0, imageUrl });
  } catch (error: any) {
    if (error.message?.includes('Only JPEG')) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    console.error('Screenshot upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload screenshot' });
  }
});

// ─── Action verification ───

/**
 * POST /waitlist/verify-action
 * Verify a social action (follow, retweet, subscribe) and award XP.
 */
router.post('/waitlist/verify-action', async (req, res) => {
  try {
    const { publicKey, taskId } = req.body;
    if (!publicKey || !taskId) {
      res.status(400).json({ success: false, error: 'publicKey and taskId are required' });
      return;
    }

    const user = await WaitlistUserModel.findOne({ publicKey }).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Check if already completed
    if (user.completedTasks?.includes(taskId)) {
      res.json({ success: true, verified: true, message: 'Already completed' });
      return;
    }

    // Check prerequisite
    const task = await WaitlistTaskModel.findOne({ taskId }).lean();
    if (!task) {
      res.status(400).json({ success: false, error: 'Unknown task' });
      return;
    }
    if (task.requiresTask && !user.completedTasks?.includes(task.requiresTask)) {
      res.status(400).json({ success: false, error: `Complete "${task.requiresTask}" first` });
      return;
    }

    let verified = false;

    switch (taskId) {
      case 'follow_cashflow_x':
      case 'follow_heymike_x': {
        if (!user.twitterId || !user.twitterAccessToken) {
          res.json({ success: true, verified: false, message: 'Connect your X account first.' });
          return;
        }
        const targetHandle = taskId === 'follow_cashflow_x' ? 'cashflow_fi' : 'heymike777';
        verified = await socialAuth.checkTwitterFollow(user.twitterAccessToken, user.twitterId, targetHandle);
        break;
      }
      case 'retweet_announcement': {
        if (!user.twitterId) {
          res.json({ success: true, verified: false, message: 'Connect your X account first.' });
          return;
        }
        const tweetId = task.metadata?.tweetId;
        if (!tweetId) {
          res.json({ success: true, verified: false, message: 'Announcement tweet not configured.' });
          return;
        }
        verified = await socialAuth.checkTwitterRetweet(tweetId, user.twitterId);
        break;
      }
      case 'subscribe_founders_tg': {
        if (!user.telegramId) {
          res.json({ success: true, verified: false, message: 'Connect your Telegram first.' });
          return;
        }
        verified = await telegram.checkChannelMember(user.telegramId, '@founders_journey');
        break;
      }
      default:
        res.status(400).json({ success: false, error: 'This task cannot be verified this way' });
        return;
    }

    if (!verified) {
      res.json({
        success: true,
        verified: false,
        message: `We couldn't verify this action. Make sure you've completed it and try again.`,
      });
      return;
    }

    const { xpReward } = await awardTaskXp(publicKey, taskId);
    res.json({ success: true, verified: true, xpAwarded: xpReward });
  } catch (error: any) {
    // Handle Twitter rate limits
    if (error?.response?.status === 429) {
      res.json({ success: true, verified: false, message: 'Rate limited. Please try again in a few minutes.' });
      return;
    }
    console.error('Verify action error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

export default router;
