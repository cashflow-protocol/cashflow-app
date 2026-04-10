import crypto from 'crypto';
import { Router } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { InviteCodeModel, WaitlistUserModel, WaitlistTaskModel, VaultPaymentModel, VaultPaymentStatus, VaultMode } from '../models';
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

    // Mark the waitlist user as approved so check-status works on app restart
    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      { $set: { status: 'approved', inviteCode: code.toUpperCase(), approvedAt: new Date() } },
      { upsert: true },
    );

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
    const { publicKey, platform, isSolanaMobile, deviceId, device } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey is required' });
      return;
    }

    const existing = await WaitlistUserModel.findOne({ publicKey });
    if (!existing) {
      await WaitlistUserModel.create({ publicKey, xp: 0, status: 'waiting', completedTasks: [] });
      const total = await WaitlistUserModel.countDocuments();
      const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
      const platformLabel = platform === 'ios' ? '🍎 iOS' : platform === 'android' ? '🤖 Android' : platform || 'unknown';
      const lines = [
        `🆕 New waitlist signup!`,
        ``,
        `Wallet: <code>${publicKey.slice(0, 6)}...${publicKey.slice(-4)}</code>`,
        `Platform: ${platformLabel}${isSolanaMobile ? ' (Solana Mobile 📱)' : ''}`,
        device ? `Device: ${device}` : null,
        `Device ID: <code>${deviceId || 'unknown'}</code>`,
        `IP: <code>${ip}</code>`,
        `Total waitlist: ${total}`,
      ].filter(Boolean).join('\n');
      telegram.notifyAdmin(lines);
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
        id: t._id.toString(),
        title: t.title,
        description: t.description,
        xpReward: t.xpReward,
        category: t.category,
        requiresTask: t.requiresTask,
        metadata: t.metadata,
        completed: completedSet.has(t._id.toString()),
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
      config: {
        // 'browser' = open OAuth in external browser (default)
        // 'webview' = open OAuth in in-app WebView (fallback for devices where X app intercepts browser)
        xOauthMode: (process.env.X_OAUTH_MODE as string) || 'browser',
      },
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
    const task = await WaitlistTaskModel.findOne({ category: 'social_connect', 'metadata.provider': 'email' }).lean();
    const taskId = task?._id.toString();
    const xpReward = task?.xpReward ?? 100;

    // Update user: save email, mark task complete, award XP (only if not already completed)
    if (taskId) {
      await WaitlistUserModel.findOneAndUpdate(
        { publicKey, completedTasks: { $ne: taskId } },
        {
          $set: { email: normalizedEmail, emailVerified: true },
          $addToSet: { completedTasks: taskId },
          $inc: { xp: xpReward },
        },
      );
    }

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

// ─── Telegram callback data store (callback_data has 64-byte limit) ───

let callbackCounter = 0;
const pendingCallbacks = new Map<string, { publicKey: string; taskId: string }>();

function storeCallback(publicKey: string, taskId: string): string {
  const id = (++callbackCounter).toString(36);
  pendingCallbacks.set(id, { publicKey, taskId });
  return id;
}

// ─── Helper: award XP for a task (prevents double award) ───

async function awardTaskXp(publicKey: string, taskQuery: Record<string, any>, extraFields?: Record<string, any>, screenshotUrl?: string) {
  const task = await WaitlistTaskModel.findOne(taskQuery).lean();
  if (!task) {
    console.error('awardTaskXp: task not found for query', taskQuery);
    return { awarded: false, xpReward: 0 };
  }

  const taskId = task._id.toString();
  const xpReward = task.xpReward ?? 100;

  const result = await WaitlistUserModel.findOneAndUpdate(
    { publicKey, completedTasks: { $ne: taskId } },
    {
      $addToSet: { completedTasks: taskId },
      $inc: { xp: xpReward },
      $set: { lastXpAt: new Date(), ...extraFields },
    },
    { new: true },
  );

  if (!result) {
    console.log('awardTaskXp: already completed', taskId, 'for', publicKey);
  }

  if (result) {
    const parts = [`✅ Task completed: <b>${task.title}</b> (+${xpReward} XP)`];
    parts.push(`\nTotal XP: ${result.xp} | Tasks: ${result.completedTasks.length}`);
    parts.push(`Wallet: <code>${publicKey.slice(0, 6)}...${publicKey.slice(-4)}</code>`);
    if (result.email) parts.push(`Email: ${result.email}`);
    if (result.twitterHandle) parts.push(`X: @${result.twitterHandle}`);
    if (result.discordUsername) parts.push(`Discord: ${result.discordUsername}`);
    if (result.telegramUsername) parts.push(`Telegram: @${result.telegramUsername}`);
    if (result.walletAddress) parts.push(`Solana: <code>${result.walletAddress.slice(0, 6)}...${result.walletAddress.slice(-4)}</code>`);

    if (screenshotUrl) {
      const cbId = storeCallback(publicKey, taskId);
      telegram.notifyAdminWithPhoto(screenshotUrl, parts.join('\n'), [
        [
          { text: '✅ Approve', callback_data: `a:${cbId}` },
          { text: '❌ Reject', callback_data: `r:${cbId}` },
        ],
      ]);
    } else {
      telegram.notifyAdmin(parts.join('\n'));
    }
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

    const { awarded, xpReward } = await awardTaskXp(publicKey, { category: 'social_connect', 'metadata.provider': 'wallet' }, {
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
 * Returns a redirect URL on our own backend to avoid X app intercepting twitter.com links.
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
 * GET /waitlist/connect-x/auth
 * Navigates to Twitter OAuth via JS — avoids X app intercepting twitter.com links on mobile.
 * (302 redirects can still trigger app links; JS navigations do not.)
 */
router.get('/waitlist/connect-x/auth', (req, res) => {
  const { state } = req.query as { state?: string };
  if (!state) {
    res.status(400).send('Missing state');
    return;
  }

  const pending = pendingOAuthStates.get(state);
  if (!pending || pending.provider !== 'twitter' || Date.now() > pending.expiresAt) {
    res.status(400).send('Invalid or expired OAuth state');
    return;
  }

  const authUrl = socialAuth.generateTwitterOAuthUrl(state, pending.codeVerifier!);
  if (!authUrl) {
    res.status(503).send('Twitter integration not configured');
    return;
  }

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>window.location.replace(${JSON.stringify(authUrl)});</script></body></html>`);
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

    await awardTaskXp(pending.publicKey, { category: 'social_connect', 'metadata.provider': 'x' }, {
      twitterId: twitterUser.id,
      twitterHandle: twitterUser.username,
      twitterAccessToken: twitterUser.accessToken,
      twitterRefreshToken: twitterUser.refreshToken,
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

    await awardTaskXp(pending.publicKey, { category: 'social_connect', 'metadata.provider': 'discord' }, {
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
    // Handle inline button callbacks (Approve/Reject screenshots)
    const callbackQuery = req.body?.callback_query;
    if (callbackQuery?.data) {
      if (!telegram.isAdmin(callbackQuery.from.id)) {
        await telegram.answerCallbackQuery(callbackQuery.id, '⛔ Unauthorized');
        res.json({ ok: true });
        return;
      }
      const [action, cbId] = callbackQuery.data.split(':');
      const cb = pendingCallbacks.get(cbId);
      if (action === 'r' && cb) {
        const { publicKey, taskId } = cb;
        pendingCallbacks.delete(cbId);
        // Revoke task: remove from completedTasks, deduct XP
        const task = await WaitlistTaskModel.findById(taskId).lean();
        const xpReward = task?.xpReward ?? 0;
        await WaitlistUserModel.findOneAndUpdate(
          { publicKey },
          {
            $pull: { completedTasks: taskId },
            $inc: { xp: -xpReward },
            $set: { lastXpAt: new Date() },
          },
        );
        await telegram.answerCallbackQuery(callbackQuery.id, `❌ Rejected. Deducted ${xpReward} XP.`);
        await telegram.editMessageCaption(
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          callbackQuery.message.caption + '\n\n❌ <b>REJECTED</b>',
        );
      } else if (action === 'a' && cbId) {
        pendingCallbacks.delete(cbId);
        await telegram.answerCallbackQuery(callbackQuery.id, '✅ Approved!');
        await telegram.editMessageCaption(
          callbackQuery.message.chat.id,
          callbackQuery.message.message_id,
          callbackQuery.message.caption + '\n\n✅ <b>APPROVED</b>',
        );
      }
      res.json({ ok: true });
      return;
    }

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

    await awardTaskXp(pending.publicKey, { category: 'social_connect', 'metadata.provider': 'telegram' }, {
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
    const { publicKey, taskId: id } = req.body;
    if (!publicKey || !id) {
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
    const key = `screenshots/${publicKey}/${id}_${Date.now()}.${ext}`;
    const imageUrl = await storage.uploadFile(req.file.buffer, key, req.file.mimetype);

    // Save screenshot reference
    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      { $push: { proofScreenshots: { taskId: id, imageUrl, uploadedAt: new Date() } } },
    );

    // Auto-approve: award XP (pass screenshot URL for admin notification)
    const { awarded, xpReward } = await awardTaskXp(publicKey, { _id: id }, undefined, imageUrl);

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
    const { publicKey, taskId: id } = req.body;
    if (!publicKey || !id) {
      res.status(400).json({ success: false, error: 'publicKey and taskId are required' });
      return;
    }

    const user = await WaitlistUserModel.findOne({ publicKey }).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Check if already completed
    if (user.completedTasks?.includes(id)) {
      res.json({ success: true, verified: true, message: 'Already completed' });
      return;
    }

    // Check prerequisite
    const task = await WaitlistTaskModel.findById(id).lean();
    if (!task) {
      res.status(400).json({ success: false, error: 'Unknown task' });
      return;
    }
    if (task.requiresTask && !user.completedTasks?.includes(task.requiresTask)) {
      res.status(400).json({ success: false, error: 'Complete prerequisite task first' });
      return;
    }

    if (task.category !== 'social_action') {
      res.status(400).json({ success: false, error: 'This task cannot be verified this way' });
      return;
    }

    let verified = false;

    console.log(`[verify-action] task=${task.title}, category=${task.category}, metadata=${JSON.stringify(task.metadata)}, twitterHandle=${user.twitterHandle}, twitterId=${user.twitterId}`);

    // Dispatch by metadata — each social_action task carries its verification data
    if (task.metadata?.handle) {
      if (!user.twitterHandle) {
        res.json({ success: true, verified: false, message: 'Connect your X account first.' });
        return;
      }
      verified = await socialAuth.checkTwitterFollow(user.twitterHandle, task.metadata.handle);
    } else if (task.metadata?.tweetId || task.metadata?.tweetUrl) {
      if (!user.twitterHandle) {
        res.json({ success: true, verified: false, message: 'Connect your X account first.' });
        return;
      }
      // Extract tweet ID from URL if needed (e.g. https://x.com/user/status/123456)
      const tweetId = task.metadata.tweetId || task.metadata.tweetUrl.split('/status/')[1]?.split('?')[0];
      if (!tweetId) {
        res.status(400).json({ success: false, error: 'Invalid tweet reference' });
        return;
      }
      verified = await socialAuth.checkTwitterRetweet(tweetId, user.twitterHandle);
    } else if (task.metadata?.channel) {
      if (!user.telegramId) {
        res.json({ success: true, verified: false, message: 'Connect your Telegram first.' });
        return;
      }
      verified = await telegram.checkChannelMember(user.telegramId, task.metadata.channel);
    } else {
      res.status(400).json({ success: false, error: 'Task is missing verification metadata' });
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

    const { xpReward } = await awardTaskXp(publicKey, { _id: id });
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

/**
 * POST /waitlist/register-device
 * Register an FCM token for a waitlist user (no auth required).
 */
router.post('/waitlist/register-device', async (req, res) => {
  try {
    const { publicKey, fcmToken } = req.body;
    if (!publicKey || !fcmToken || typeof fcmToken !== 'string') {
      res.status(400).json({ success: false, error: 'publicKey and fcmToken are required' });
      return;
    }

    await WaitlistUserModel.findOneAndUpdate(
      { publicKey },
      { $addToSet: { fcmTokens: fcmToken } },
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Waitlist register device error:', error);
    res.status(500).json({ success: false, error: 'Failed to register device' });
  }
});

// ─── Vault creation (backend-signed) ───

/**
 * Validate that a string is a valid base58-encoded 32-byte Solana public key.
 */
function isValidPublicKey(key: string): boolean {
  try {
    const bs58Chars = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
    if (!bs58Chars.test(key) || key.length < 32 || key.length > 44) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /create-vault
 * Build a multisigCreateV2 transaction on the backend.
 *
 * - Standard mode (iOS/web): admin wallet pays gas & rent, tx is signed and sent by backend.
 * - Seeker / android_gms mode: MWA wallet pays, tx is partially signed (createKey only)
 *   and returned to the client for MWA signing + sending.
 */
router.post('/create-vault', async (req, res) => {
  try {
    const { paymentId, platform, mode, deviceKey, cloudKey, walletAddress } = req.body;

    // ── Validate inputs ──
    if (!paymentId || typeof paymentId !== 'string') {
      res.status(400).json({ success: false, error: 'paymentId is required' });
      return;
    }
    if (!platform || !['ios', 'android'].includes(platform)) {
      res.status(400).json({ success: false, error: 'platform must be ios or android' });
      return;
    }
    if (!mode || !Object.values(VaultMode).includes(mode)) {
      res.status(400).json({ success: false, error: 'mode must be standard, seeker, or android_gms' });
      return;
    }
    if (!deviceKey || !isValidPublicKey(deviceKey)) {
      res.status(400).json({ success: false, error: 'deviceKey must be a valid public key' });
      return;
    }

    const needsCloudKey = mode !== VaultMode.SEEKER;
    const needsWallet = mode === VaultMode.SEEKER || mode === VaultMode.ANDROID_GMS;

    if (needsCloudKey && (!cloudKey || !isValidPublicKey(cloudKey))) {
      res.status(400).json({ success: false, error: 'cloudKey is required for this mode' });
      return;
    }
    if (needsWallet && (!walletAddress || !isValidPublicKey(walletAddress))) {
      res.status(400).json({ success: false, error: 'walletAddress is required for this mode' });
      return;
    }

    // Ensure all member keys are distinct
    const memberKeys = [deviceKey, cloudKey, walletAddress].filter(Boolean);
    if (new Set(memberKeys).size !== memberKeys.length) {
      res.status(400).json({ success: false, error: 'All member keys must be distinct' });
      return;
    }

    // ── Check paymentId not already used (atomic) ──
    const existing = await VaultPaymentModel.findOne({ paymentId });
    if (existing) {
      if (existing.status === VaultPaymentStatus.USED) {
        res.status(409).json({ success: false, error: 'Payment ID already used' });
        return;
      }
      // If pending/failed from a previous attempt, allow retry
    }

    const paymentRecord = existing || await VaultPaymentModel.create({
      paymentId,
      platform,
      mode,
      status: VaultPaymentStatus.PENDING,
      cloudKey: cloudKey || undefined,
      deviceKey,
      walletAddress: walletAddress || undefined,
    });

    // ── Lazy-import Squads SDK + web3.js ──
    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, SystemProgram, TransactionInstruction } = await import('@solana/web3.js');
    const { Permissions } = multisigLib.types;

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl, 'confirmed');

    // ── Determine members, threshold ──
    let members: Array<{ key: InstanceType<typeof PublicKey>; permissions: ReturnType<typeof Permissions.all> }>;
    let threshold: number;

    const devicePubkey = new PublicKey(deviceKey);

    if (mode === VaultMode.SEEKER) {
      const walletPubkey = new PublicKey(walletAddress);
      members = [
        { key: walletPubkey, permissions: Permissions.all() },
        { key: devicePubkey, permissions: Permissions.all() },
      ];
      threshold = 2;
    } else if (mode === VaultMode.ANDROID_GMS) {
      const cloudPubkey = new PublicKey(cloudKey);
      const walletPubkey = new PublicKey(walletAddress);
      members = [
        { key: cloudPubkey, permissions: Permissions.all() },
        { key: devicePubkey, permissions: Permissions.all() },
        { key: walletPubkey, permissions: Permissions.all() },
      ];
      threshold = 3;
    } else {
      // standard (iOS / web)
      const cloudPubkey = new PublicKey(cloudKey);
      members = [
        { key: cloudPubkey, permissions: Permissions.all() },
        { key: devicePubkey, permissions: Permissions.all() },
      ];
      threshold = 2;
    }

    // ── Load admin keypair (needed for all modes: gas payer for standard, spending limit fee payer for MWA) ──
    if (!process.env.ADMIN_FEE_PAYER_PRIVATE_KEY) {
      res.status(503).json({ success: false, error: 'Admin wallet not configured' });
      return;
    }
    const { getBase58Encoder } = await import('@solana/kit');
    const adminKeypair = Keypair.fromSecretKey(
      new Uint8Array(getBase58Encoder().encode(process.env.ADMIN_FEE_PAYER_PRIVATE_KEY)),
    );

    // ── Determine fee payer ──
    const isAdminPays = mode === VaultMode.STANDARD;
    let feePayer: InstanceType<typeof PublicKey>;

    if (isAdminPays) {
      feePayer = adminKeypair.publicKey;

      // Check admin balance
      const adminBalance = await conn.getBalance(feePayer);
      if (adminBalance < 10_000_000) { // 0.01 SOL
        console.error('[create-vault] Admin wallet balance too low:', adminBalance);
        telegram.notifyAdmin(`⚠️ Admin wallet balance critically low: ${(adminBalance / 1e9).toFixed(4)} SOL`);
        res.status(503).json({ success: false, error: 'Service temporarily unavailable' });
        return;
      }
      else if (adminBalance < 50_000_000) { // 0.05 SOL
        console.error('[create-vault] Admin wallet balance is too low (but still can proceed):', adminBalance);
        telegram.notifyAdmin(`⚠️ Admin wallet (for fee creation) balance is low: ${(adminBalance / 1e9).toFixed(4)} SOL. Admin wallet address: ${feePayer}`);
      }
    } else {
      feePayer = new PublicKey(walletAddress);

      // Check user wallet balance — needs rent (~0.015 SOL) + creation fee (0.05 SOL) + tx fee
      const { VAULT_CREATION_FEE } = await import('../constants/vault');
      const minRequired = VAULT_CREATION_FEE + 20_000_000; // fee + rent + buffer
      const userBalance = await conn.getBalance(feePayer);
      if (userBalance < minRequired) {
        res.status(400).json({
          success: false,
          error: `Insufficient balance. You need at least ${(minRequired / 1e9).toFixed(3)} SOL to create a vault. Current balance: ${(userBalance / 1e9).toFixed(4)} SOL`,
        });
        return;
      }
    }

    // ── Build multisigCreateV2 transaction ──
    const createKey = Keypair.generate();

    const [multisigPda] = multisigLib.getMultisigPda({ createKey: createKey.publicKey });
    const [vaultPda] = multisigLib.getVaultPda({ multisigPda, index: 0 });

    // Fetch program config for treasury
    const [programConfigPda] = multisigLib.getProgramConfigPda({});
    const programConfig = await multisigLib.accounts.ProgramConfig.fromAccountAddress(
      conn,
      programConfigPda,
    );

    const createMultisigIx = multisigLib.instructions.multisigCreateV2({
      treasury: programConfig.treasury,
      createKey: createKey.publicKey,
      creator: feePayer,
      multisigPda,
      configAuthority: null,
      threshold,
      members,
      timeLock: 0,
      rentCollector: vaultPda,
      memo: 'cashflow',
    });

    const { blockhash } = await conn.getLatestBlockhash('confirmed');

    const { HeliusSender } = await import('../managers/HeliusSender');

    const txInstructions = [createMultisigIx];

    // Add vault creation fee (0.05 SOL → treasury wallet) for all modes
    const { VAULT_CREATION_FEE } = await import('../constants/vault');
    if (VAULT_CREATION_FEE > 0 && !isAdminPays) {
      const treasuryWallet = process.env.TREASURY_WALLET_ADDRESS;
      if (!treasuryWallet) {
        res.status(503).json({ success: false, error: 'Treasury wallet not configured' });
        return;
      }
      txInstructions.push(SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: new PublicKey(treasuryWallet),
        lamports: VAULT_CREATION_FEE,
      }));
    }

    // Add Helius SWQoS tip for standard mode (admin pays)
    if (isAdminPays) {
      txInstructions.push(HeliusSender.createTipIx(feePayer));
    }

    const msg = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: txInstructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);

    // Always sign with ephemeral createKey
    tx.sign([createKey]);

    const multisigAddress = multisigPda.toBase58();
    const vaultAddress = vaultPda.toBase58();

    if (isAdminPays) {
      // ── Standard mode: admin signs + sends via Helius SWQoS ──
      tx.sign([adminKeypair]);

      const base64Tx = Buffer.from(tx.serialize()).toString('base64');
      const signature = await HeliusSender.sendAndConfirm(base64Tx);

      await VaultPaymentModel.findByIdAndUpdate(paymentRecord._id, {
        $set: {
          status: VaultPaymentStatus.USED,
          multisigAddress,
          vaultAddress,
          txSignature: signature,
        },
      });

      const lookupKeyStd = cloudKey || deviceKey;
      const waitlistUserStd = await WaitlistUserModel.findOne({ publicKey: lookupKeyStd }).lean();

      telegram.notifyAdmin(
        `🏦 New Squad created!\n\n` +
        (walletAddress ? `Wallet: <code>${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}</code>\n` : '') +
        `Vault: <code>${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}</code>\n` +
        `Mode: ${mode}\n` +
        `Platform: ${platform}\n` +
        (waitlistUserStd?.inviteCode ? `Invite: <code>${waitlistUserStd.inviteCode}</code>\n` : '') +
        `IP: <code>${req.ip}</code>`,
      );

      res.json({
        success: true,
        data: { multisigAddress, vaultAddress, txSignature: signature },
        timestamp: new Date().toISOString(),
      });
    } else {
      // ── Seeker / android_gms: build all txs (vault creation + spending limit) ──
      // so mobile can sign everything in a single MWA prompt and send as one Jito bundle.

      const crypto = await import('crypto');
      const { ADMIN_COVER_TARGET, GAS_COVER_SPENDING_LIMIT_SEED, JITO_TIP_LAMPORTS, JITO_TIP_ACCOUNTS } = await import('../constants/vault');
      const { Period } = multisigLib.types;

      // Use the all-tx fee payer key for spending limit (must match cover instruction destination)
      const { getAdminTxFeePayerPublicKey, getAdminTxFeePayerKeypair } = await import('../services/adminFeePayer');
      const adminFeePayerPubkey = getAdminTxFeePayerPublicKey();
      const adminTxFeePayerKeypair = getAdminTxFeePayerKeypair();

      // Deterministic createKey for spending limit PDA (must match mobile logic)
      const spendingLimitHash = crypto.createHash('sha256')
        .update(GAS_COVER_SPENDING_LIMIT_SEED)
        .update(multisigPda.toBytes())
        .digest();
      const spendingLimitCreateKey = new PublicKey(spendingLimitHash.slice(0, 32));

      // For a newly created multisig, transactionIndex starts at 0, so first config tx = 1
      const transactionIndex = 1n;

      // Primary key (creator for config txs)
      const primaryKey = mode === VaultMode.SEEKER
        ? new PublicKey(walletAddress)
        : new PublicKey(cloudKey);

      // Spending limit members
      const spendingLimitMembers = mode === VaultMode.SEEKER
        ? [new PublicKey(walletAddress)]
        : [new PublicKey(cloudKey)];

      // Build approval instructions
      const approvalIxs: ReturnType<typeof multisigLib.instructions.proposalApprove>[] = [];
      if (mode === VaultMode.SEEKER) {
        approvalIxs.push(
          multisigLib.instructions.proposalApprove({ multisigPda, transactionIndex, member: new PublicKey(walletAddress) }),
          multisigLib.instructions.proposalApprove({ multisigPda, transactionIndex, member: devicePubkey }),
        );
      } else {
        // android_gms: cloud + device + wallet approve
        approvalIxs.push(
          multisigLib.instructions.proposalApprove({ multisigPda, transactionIndex, member: new PublicKey(cloudKey) }),
          multisigLib.instructions.proposalApprove({ multisigPda, transactionIndex, member: devicePubkey }),
          multisigLib.instructions.proposalApprove({ multisigPda, transactionIndex, member: new PublicKey(walletAddress) }),
        );
      }

      // TX2: config tx create + proposal + approvals (admin pays gas)
      const tx2Instructions = [
        multisigLib.instructions.configTransactionCreate({
          multisigPda,
          transactionIndex,
          creator: primaryKey,
          rentPayer: adminFeePayerPubkey,
          actions: [{
            __kind: 'AddSpendingLimit' as const,
            createKey: spendingLimitCreateKey,
            vaultIndex: 0,
            mint: PublicKey.default, // native SOL
            amount: ADMIN_COVER_TARGET,
            period: Period.Day,
            members: spendingLimitMembers,
            destinations: [adminFeePayerPubkey],
          }],
        }),
        multisigLib.instructions.proposalCreate({ multisigPda, transactionIndex, creator: primaryKey, rentPayer: adminFeePayerPubkey }),
        ...approvalIxs,
      ];

      // Derive spending limit PDA — needed as remaining account for configTransactionExecute
      const [spendingLimitPda] = multisigLib.getSpendingLimitPda({
        multisigPda,
        createKey: spendingLimitCreateKey,
      });

      // TX3: execute + close + Jito tip + cover (admin pays gas, MWA wallet reimburses)
      const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

      // Build cover instruction: MWA wallet tops up admin fee payer to ADMIN_COVER_TARGET
      const { createCoverInstruction } = await import('@heymike/send');
      const { address: kitAddress, AccountRole } = await import('@solana/kit');
      const coverKitIx = createCoverInstruction(
        kitAddress(walletAddress),
        kitAddress(walletAddress),
        kitAddress(adminFeePayerPubkey.toBase58()),
        ADMIN_COVER_TARGET,
      );
      const coverIx = new TransactionInstruction({
        programId: new PublicKey(coverKitIx.programAddress as string),
        keys: (coverKitIx.accounts ?? []).map((acc: any) => ({
          pubkey: new PublicKey(acc.address as string),
          isSigner: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.READONLY_SIGNER,
          isWritable: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.WRITABLE,
        })),
        data: Buffer.from(coverKitIx.data as Uint8Array),
      });

      const tx3Instructions = [
        multisigLib.instructions.configTransactionExecute({ multisigPda, transactionIndex, member: primaryKey, rentPayer: adminFeePayerPubkey, spendingLimits: [spendingLimitPda] }),
        multisigLib.instructions.configTransactionAccountsClose({
          multisigPda, transactionIndex, rentCollector: vaultPda,
        }),
        SystemProgram.transfer({
          fromPubkey: adminFeePayerPubkey,
          toPubkey: new PublicKey(tipAccount),
          lamports: JITO_TIP_LAMPORTS,
        }),
        coverIx,
      ];

      // Fetch LUT for tx compression
      let luts: any[] = [];
      const { LookupManager } = await import('../managers/LookupManager');
      if (LookupManager.lookupTableAddress) {
        const lutAccount = await conn.getAddressLookupTable(new PublicKey(LookupManager.lookupTableAddress as string));
        if (lutAccount.value) {
          luts = [lutAccount.value];
        }
      }

      const msg2 = new TransactionMessage({
        payerKey: adminFeePayerPubkey,
        recentBlockhash: blockhash,
        instructions: tx2Instructions,
      }).compileToV0Message(luts);
      const tx2 = new VersionedTransaction(msg2);

      const msg3 = new TransactionMessage({
        payerKey: adminFeePayerPubkey,
        recentBlockhash: blockhash,
        instructions: tx3Instructions,
      }).compileToV0Message(luts);
      const tx3 = new VersionedTransaction(msg3);

      // Admin tx fee payer signs TX2 and TX3 (fee payer + rent payer)
      tx2.sign([adminTxFeePayerKeypair]);
      tx3.sign([adminTxFeePayerKeypair]);

      const serializedTxs = [
        Buffer.from(tx.serialize()).toString('base64'),
        Buffer.from(tx2.serialize()).toString('base64'),
        Buffer.from(tx3.serialize()).toString('base64'),
      ];

      await VaultPaymentModel.findByIdAndUpdate(paymentRecord._id, {
        $set: { multisigAddress, vaultAddress },
      });

      res.json({
        success: true,
        data: { multisigAddress, vaultAddress, serializedTxs },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error('[create-vault] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create vault' });
  }
});

/**
 * POST /confirm-vault
 * Called by mobile after signing and sending a vault creation tx (Seeker/android_gms mode).
 * Updates the VaultPayment record to 'used' with the on-chain signature.
 */
router.post('/confirm-vault', async (req, res) => {
  try {
    const { paymentId, txSignature } = req.body;

    if (!paymentId || typeof paymentId !== 'string') {
      res.status(400).json({ success: false, error: 'paymentId is required' });
      return;
    }
    if (!txSignature || typeof txSignature !== 'string') {
      res.status(400).json({ success: false, error: 'txSignature is required' });
      return;
    }

    const result = await VaultPaymentModel.findOneAndUpdate(
      { paymentId, status: VaultPaymentStatus.PENDING },
      { $set: { status: VaultPaymentStatus.USED, txSignature } },
      { new: true },
    );

    if (!result) {
      res.status(404).json({ success: false, error: 'Payment not found or already confirmed' });
      return;
    }

    // Look up invite code from waitlist (cloud key for standard, device key for seeker)
    const lookupKey = result.cloudKey || result.deviceKey;
    const waitlistUser = await WaitlistUserModel.findOne({ publicKey: lookupKey }).lean();

    telegram.notifyAdmin(
      `🏦 New Squad created!\n\n` +
      `Wallet: <code>${result.walletAddress?.slice(0, 6)}...${result.walletAddress?.slice(-4)}</code>\n` +
      `Vault: <code>${result.vaultAddress?.slice(0, 6)}...${result.vaultAddress?.slice(-4)}</code>\n` +
      `Mode: ${result.mode}\n` +
      `Platform: ${result.platform}\n` +
      (waitlistUser?.inviteCode ? `Invite: <code>${waitlistUser.inviteCode}</code>\n` : '') +
      `IP: <code>${req.ip}</code>`,
    );

    res.json({
      success: true,
      data: {
        multisigAddress: result.multisigAddress,
        vaultAddress: result.vaultAddress,
        txSignature,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[confirm-vault] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to confirm vault' });
  }
});

export default router;
