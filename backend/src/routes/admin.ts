import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { InviteCodeModel, WaitlistUserModel, WaitlistTaskModel, UserModel, DeviceTokenModel, NotificationType, EarnTokenModel, TransactionModel, UserCostBasisModel, RewardTaskModel, RewardVerifierType, UserRewardProgressModel, RewardProgressStatus, MintedBadgeModel, getSetting, setSetting, APP_SETTING_KEYS } from '../models';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { PriceManager } from '../managers';
import { dispatchSystemNotification } from '../services/notificationService';
import * as storage from '../services/storageManager';

const priceManager = new PriceManager();

const router = Router();

const ADMIN_TOKEN_EXPIRY = '2h';

// ─── Auth ───

/**
 * POST /login
 * Exchange admin password for a short-lived JWT.
 */
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (
    !process.env.ADMIN_PASSWORD ||
    !password ||
    !crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(process.env.ADMIN_PASSWORD),
    )
  ) {
    res.status(401).json({ success: false, error: 'Invalid password' });
    return;
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, {
    expiresIn: ADMIN_TOKEN_EXPIRY,
  });

  res.json({ success: true, token });
});

/**
 * Middleware: verify admin JWT on all subsequent routes.
 */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice(7);

  // Support legacy raw-password auth during migration (compare timing-safe)
  if (process.env.ADMIN_PASSWORD && token === process.env.ADMIN_PASSWORD) {
    // Legacy: still allow raw password but recommend migration
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { role: string };
    if (payload.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

router.use(requireAdmin);

// ─── Stats ───

/**
 * GET /stats
 * Aggregate counts for the admin dashboard.
 */
router.get('/stats', async (_req, res) => {
  try {
    const now = new Date();
    const startOfTodayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfYesterdayUTC = new Date(startOfTodayUTC.getTime() - 86_400_000);

    const [
      usersTotal,
      usersToday,
      usersYesterday,
      waitlistTotal,
      waitlistApproved,
      waitlistNotApproved,
      waitlistYesterdayApproved,
      waitlistYesterdayNotApproved,
      waitlistTodayApproved,
      waitlistTodayNotApproved,
      txTotal,
      txToday,
      txYesterday,
      depositsTotal,
      depositsToday,
      depositsYesterday,
      withdrawalsTotal,
      withdrawalsToday,
      withdrawalsYesterday,
      transfersTotal,
      transfersToday,
      transfersYesterday,
      costBasisRecords,
    ] = await Promise.all([
      // Users
      UserModel.countDocuments({}),
      UserModel.countDocuments({ createdAt: { $gte: startOfTodayUTC } }),
      UserModel.countDocuments({ createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC } }),
      // Waitlist totals
      WaitlistUserModel.countDocuments({}),
      WaitlistUserModel.countDocuments({ approvedAt: { $exists: true } }),
      WaitlistUserModel.countDocuments({ approvedAt: { $exists: false } }),
      // Waitlist yesterday
      WaitlistUserModel.countDocuments({ createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC }, approvedAt: { $exists: true } }),
      WaitlistUserModel.countDocuments({ createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC }, approvedAt: { $exists: false } }),
      // Waitlist today
      WaitlistUserModel.countDocuments({ createdAt: { $gte: startOfTodayUTC }, approvedAt: { $exists: true } }),
      WaitlistUserModel.countDocuments({ createdAt: { $gte: startOfTodayUTC }, approvedAt: { $exists: false } }),
      // Transactions totals
      TransactionModel.countDocuments({}),
      TransactionModel.countDocuments({ createdAt: { $gte: startOfTodayUTC } }),
      TransactionModel.countDocuments({ createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC } }),
      // Deposits
      TransactionModel.countDocuments({ action: 'deposit' }),
      TransactionModel.countDocuments({ action: 'deposit', createdAt: { $gte: startOfTodayUTC } }),
      TransactionModel.countDocuments({ action: 'deposit', createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC } }),
      // Withdrawals
      TransactionModel.countDocuments({ action: 'withdraw' }),
      TransactionModel.countDocuments({ action: 'withdraw', createdAt: { $gte: startOfTodayUTC } }),
      TransactionModel.countDocuments({ action: 'withdraw', createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC } }),
      // Transfers
      TransactionModel.countDocuments({ action: 'transfer' }),
      TransactionModel.countDocuments({ action: 'transfer', createdAt: { $gte: startOfTodayUTC } }),
      TransactionModel.countDocuments({ action: 'transfer', createdAt: { $gte: startOfYesterdayUTC, $lt: startOfTodayUTC } }),
      // TVL source: aggregate net deposits per mint from UserCostBasis
      UserCostBasisModel.find({}, { mint: 1, totalDeposited: 1, totalWithdrawn: 1 }).lean(),
    ]);

    // Compute TVL (net deposited - withdrawn) per mint, in UI units and USD
    const netByMint = new Map<string, bigint>();
    for (const cb of costBasisRecords) {
      const net = BigInt(cb.totalDeposited || '0') - BigInt(cb.totalWithdrawn || '0');
      netByMint.set(cb.mint, (netByMint.get(cb.mint) ?? 0n) + net);
    }

    const tvlCoins: Array<{ mint: string; symbol: string; tvlUi: number; tvlUsd: number }> = [];
    for (const [mint, netRaw] of netByMint) {
      if (netRaw <= 0n) continue;
      const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
      if (!tokenInfo) continue;
      const tvlUi = Number(netRaw) / 10 ** tokenInfo.decimals;
      const tvlUsd = priceManager.getUsdValue(tokenInfo.symbol, tvlUi);
      tvlCoins.push({ mint, symbol: tokenInfo.symbol, tvlUi, tvlUsd });
    }
    tvlCoins.sort((a, b) => b.tvlUsd - a.tvlUsd);
    const tvlTotalUsd = tvlCoins.reduce((acc, c) => acc + c.tvlUsd, 0);

    res.json({
      success: true,
      users: { total: usersTotal, today: usersToday, yesterday: usersYesterday },
      waitlist: {
        total: waitlistTotal,
        approved: waitlistApproved,
        notApproved: waitlistNotApproved,
        yesterday: { approved: waitlistYesterdayApproved, notApproved: waitlistYesterdayNotApproved },
        today: { approved: waitlistTodayApproved, notApproved: waitlistTodayNotApproved },
      },
      transactions: {
        total: txTotal,
        today: txToday,
        yesterday: txYesterday,
        deposits: { total: depositsTotal, today: depositsToday, yesterday: depositsYesterday },
        withdrawals: { total: withdrawalsTotal, today: withdrawalsToday, yesterday: withdrawalsYesterday },
        transfers: { total: transfersTotal, today: transfersToday, yesterday: transfersYesterday },
      },
      tvl: {
        coins: tvlCoins,
        totalUsd: tvlTotalUsd,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ─── Invite Codes ───

/**
 * GET /invite-codes
 * List all invite codes with usage stats.
 */
router.get('/invite-codes', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string) || '';

    const filter: any = {};
    if (search) {
      filter.code = { $regex: search.toUpperCase(), $options: 'i' };
    }

    const [codes, total] = await Promise.all([
      InviteCodeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      InviteCodeModel.countDocuments(filter),
    ]);

    res.json({
      success: true,
      codes: codes.map((c) => ({
        id: c._id,
        code: c.code,
        maxUses: c.maxUses,
        useCount: c.useCount,
        usedBy: c.usedBy,
        source: c.source,
        createdAt: (c as any).createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Admin list invite codes error:', error);
    res.status(500).json({ success: false, error: 'Failed to list invite codes' });
  }
});

/**
 * POST /invite-codes/generate
 * Generate N random single-use invite codes.
 */
router.post('/invite-codes/generate', async (req, res) => {
  try {
    const count = Math.min(100, Math.max(1, parseInt(req.body.count) || 1));
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      while (attempts < 10) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        try {
          await InviteCodeModel.create({ code, maxUses: 1, useCount: 0, source: 'admin' });
          codes.push(code);
          break;
        } catch (err: any) {
          if (err.code === 11000) {
            attempts++;
            continue;
          }
          throw err;
        }
      }
    }

    res.json({ success: true, codes, count: codes.length });
  } catch (error) {
    console.error('Admin generate invite codes error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate codes' });
  }
});

/**
 * POST /invite-codes/custom
 * Create a custom invite code with a specific number of uses.
 */
router.post('/invite-codes/custom', async (req, res) => {
  try {
    const { code, maxUses } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ success: false, error: 'code is required' });
      return;
    }

    const uses = Math.max(1, parseInt(maxUses) || 1);

    try {
      await InviteCodeModel.create({
        code: code.toUpperCase(),
        maxUses: uses,
        useCount: 0,
        source: 'admin_custom',
      });
    } catch (err: any) {
      if (err.code === 11000) {
        res.status(409).json({ success: false, error: 'Code already exists' });
        return;
      }
      throw err;
    }

    res.json({ success: true, code: code.toUpperCase(), maxUses: uses });
  } catch (error) {
    console.error('Admin create custom code error:', error);
    res.status(500).json({ success: false, error: 'Failed to create code' });
  }
});

/**
 * DELETE /invite-codes/:id
 * Delete an invite code.
 */
router.delete('/invite-codes/:id', async (req, res) => {
  try {
    const result = await InviteCodeModel.findByIdAndDelete(req.params.id);
    if (!result) {
      res.status(404).json({ success: false, error: 'Code not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete invite code error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete code' });
  }
});

// ─── Waitlist Users ───

/**
 * GET /waitlist-users
 * List all waitlist users with social data and status.
 */
router.get('/waitlist-users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string) || '';
    const sortBy = (req.query.sortBy as string) || 'xp';
    const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { publicKey: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { twitterHandle: { $regex: search, $options: 'i' } },
        { discordUsername: { $regex: search, $options: 'i' } },
        { telegramUsername: { $regex: search, $options: 'i' } },
        { walletAddress: { $regex: search, $options: 'i' } },
      ];
    }

    const sort: any = {};
    sort[sortBy] = sortDir;
    if (sortBy === 'xp') sort.lastXpAt = 1; // tiebreaker

    const [users, total] = await Promise.all([
      WaitlistUserModel.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WaitlistUserModel.countDocuments(filter),
    ]);

    // Compute ranks for each user
    const usersWithRank = await Promise.all(
      users.map(async (u) => {
        const above = await WaitlistUserModel.countDocuments({
          status: 'waiting',
          $or: [
            { xp: { $gt: u.xp } },
            { xp: u.xp, lastXpAt: { $lt: u.lastXpAt ?? new Date() } },
          ],
        });
        return {
          id: u._id,
          publicKey: u.publicKey,
          email: u.email || null,
          emailVerified: u.emailVerified || false,
          twitterHandle: u.twitterHandle || null,
          discordUsername: u.discordUsername || null,
          telegramUsername: u.telegramUsername || null,
          walletAddress: u.walletAddress || null,
          xp: u.xp,
          rank: above + 1,
          status: u.status,
          inviteCode: u.inviteCode || null,
          completedTasks: u.completedTasks,
          createdAt: (u as any).createdAt,
        };
      }),
    );

    res.json({
      success: true,
      users: usersWithRank,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Admin list waitlist users error:', error);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

// ─── Waitlist Tasks ───

/**
 * GET /waitlist-tasks
 * List all waitlist tasks.
 */
router.get('/waitlist-tasks', async (req, res) => {
  try {
    const tasks = await WaitlistTaskModel.find().sort({ sortOrder: 1 }).lean();
    res.json({
      success: true,
      tasks: tasks.map((t) => ({
        id: t._id,
        title: t.title,
        description: t.description || '',
        xpReward: t.xpReward,
        active: t.active,
        sortOrder: t.sortOrder,
        requiresTask: t.requiresTask || null,
        category: t.category,
        metadata: t.metadata || {},
        createdAt: (t as any).createdAt,
      })),
    });
  } catch (error) {
    console.error('Admin list waitlist tasks error:', error);
    res.status(500).json({ success: false, error: 'Failed to list tasks' });
  }
});

/**
 * POST /waitlist-tasks
 * Create a new waitlist task.
 */
router.post('/waitlist-tasks', async (req, res) => {
  try {
    const { title, description, xpReward, active, sortOrder, requiresTask, category, metadata } = req.body;
    if (!title || xpReward == null || !category) {
      res.status(400).json({ success: false, error: 'title, xpReward, and category are required' });
      return;
    }

    const task = await WaitlistTaskModel.create({
      title,
      description: description || '',
      xpReward: Number(xpReward),
      active: active !== false,
      sortOrder: Number(sortOrder) || 0,
      requiresTask: requiresTask || undefined,
      category,
      metadata: metadata || {},
    });

    res.json({ success: true, task: { id: task._id } });
  } catch (error) {
    console.error('Admin create waitlist task error:', error);
    res.status(500).json({ success: false, error: 'Failed to create task' });
  }
});

/**
 * GET /waitlist-tasks/export
 * Export all tasks as portable JSON (no _ids, requiresTask as title).
 */
router.get('/waitlist-tasks/export', async (req, res) => {
  try {
    const tasks = await WaitlistTaskModel.find().sort({ sortOrder: 1 }).lean();
    const idToTitle = new Map(tasks.map((t) => [t._id.toString(), t.title]));

    const exported = tasks.map((t) => ({
      title: t.title,
      description: t.description || '',
      xpReward: t.xpReward,
      active: t.active,
      sortOrder: t.sortOrder,
      requiresTask: t.requiresTask ? idToTitle.get(t.requiresTask) || null : null,
      category: t.category,
      metadata: t.metadata || {},
    }));

    res.json({ success: true, tasks: exported });
  } catch (error) {
    console.error('Admin export waitlist tasks error:', error);
    res.status(500).json({ success: false, error: 'Failed to export tasks' });
  }
});

/**
 * POST /waitlist-tasks/import
 * Import tasks from portable JSON. Creates new tasks, resolves requiresTask by title.
 */
router.post('/waitlist-tasks/import', async (req, res) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      res.status(400).json({ success: false, error: 'tasks array is required' });
      return;
    }

    // Drop legacy taskId index if it still exists (blocks import on fresh envs)
    try {
      await WaitlistTaskModel.collection.dropIndex('taskId_1');
    } catch {
      // Index doesn't exist — fine
    }

    // Phase 1: Create all tasks without requiresTask
    const titleToId = new Map<string, string>();
    const pendingRequires: { id: string; requiresTitle: string }[] = [];

    for (const t of tasks) {
      if (!t.title || !t.category || t.xpReward == null) {
        continue;
      }
      const task = await WaitlistTaskModel.create({
        title: t.title,
        description: t.description || '',
        xpReward: Number(t.xpReward),
        active: t.active !== false,
        sortOrder: Number(t.sortOrder) || 0,
        category: t.category,
        metadata: t.metadata || {},
      });
      titleToId.set(t.title, task._id.toString());
      if (t.requiresTask) {
        pendingRequires.push({ id: task._id.toString(), requiresTitle: t.requiresTask });
      }
    }

    // Phase 2: Resolve requiresTask references by title
    for (const { id, requiresTitle } of pendingRequires) {
      const reqId = titleToId.get(requiresTitle);
      if (reqId) {
        await WaitlistTaskModel.findByIdAndUpdate(id, { $set: { requiresTask: reqId } });
      }
    }

    res.json({ success: true, imported: titleToId.size });
  } catch (error: any) {
    console.error('Admin import waitlist tasks error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to import tasks' });
  }
});

/**
 * PUT /waitlist-tasks/:id
 * Update a waitlist task.
 */
router.put('/waitlist-tasks/:id', async (req, res) => {
  try {
    const { title, description, xpReward, active, sortOrder, requiresTask, category, metadata } = req.body;

    const update: any = {};
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (xpReward !== undefined) update.xpReward = Number(xpReward);
    if (active !== undefined) update.active = active;
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
    if (requiresTask !== undefined) update.requiresTask = requiresTask || undefined;
    if (category !== undefined) update.category = category;
    if (metadata !== undefined) update.metadata = metadata;

    const task = await WaitlistTaskModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update waitlist task error:', error);
    res.status(500).json({ success: false, error: 'Failed to update task' });
  }
});

/**
 * DELETE /waitlist-tasks/:id
 * Delete a waitlist task.
 */
router.delete('/waitlist-tasks/:id', async (req, res) => {
  try {
    const result = await WaitlistTaskModel.findByIdAndDelete(req.params.id);
    if (!result) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete waitlist task error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete task' });
  }
});

// ─── Waitlist User Actions ───

/**
 * GET /waitlist-users/:id/screenshots
 * Get all proof screenshots for a user.
 */
router.get('/waitlist-users/:id/screenshots', async (req, res) => {
  try {
    const user = await WaitlistUserModel.findById(req.params.id).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, screenshots: user.proofScreenshots || [] });
  } catch (error) {
    console.error('Admin get screenshots error:', error);
    res.status(500).json({ success: false, error: 'Failed to get screenshots' });
  }
});

/**
 * POST /waitlist-users/:id/revoke-task
 * Revoke a completed task: remove from completedTasks, deduct XP.
 */
router.post('/waitlist-users/:id/revoke-task', async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) {
      res.status(400).json({ success: false, error: 'taskId is required' });
      return;
    }

    const user = await WaitlistUserModel.findById(req.params.id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (!user.completedTasks.includes(taskId)) {
      res.status(400).json({ success: false, error: 'Task is not completed' });
      return;
    }

    // Look up XP reward
    const task = await WaitlistTaskModel.findById(taskId).lean();
    const xpToDeduct = task?.xpReward ?? 0;

    await WaitlistUserModel.findByIdAndUpdate(req.params.id, {
      $pull: { completedTasks: taskId },
      $inc: { xp: -xpToDeduct },
      $set: { lastXpAt: new Date() },
    });

    res.json({ success: true, xpDeducted: xpToDeduct });
  } catch (error) {
    console.error('Admin revoke task error:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke task' });
  }
});

// ─── App Users ───

/**
 * GET /users
 * List all registered app users (with vaults).
 */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string) || '';

    const filter: any = {};
    if (search) {
      filter.$or = [
        { vaultAddress: { $regex: search, $options: 'i' } },
        { publicKey: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(filter),
    ]);

    // Check which users have device tokens registered
    const userIds = users.map((u) => String(u._id));
    const tokensWithUsers = await DeviceTokenModel.distinct('userId', { userId: { $in: userIds } });
    const usersWithPush = new Set(tokensWithUsers.map(String));

    res.json({
      success: true,
      users: users.map((u) => ({
        id: u._id,
        vaultAddress: u.vaultAddress,
        publicKey: u.publicKey,
        lastSeenAt: u.lastSeenAt,
        inviteCode: u.inviteCode || null,
        hasPush: usersWithPush.has(String(u._id)),
        createdAt: (u as any).createdAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

/**
 * POST /users/:id/send-notification
 * Send a push + in-app notification to a specific user.
 */
router.post('/users/:id/send-notification', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }

    const user = await UserModel.findById(req.params.id).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    await dispatchSystemNotification(
      user.vaultAddress,
      title,
      body || undefined,
      NotificationType.SYSTEM,
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Admin send notification error:', error);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

/**
 * POST /users/broadcast-notification
 * Send a push + in-app notification to ALL users.
 */
router.post('/users/broadcast-notification', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ success: false, error: 'title is required' });
      return;
    }

    const users = await UserModel.find({}).select('vaultAddress').lean();
    let sent = 0;

    for (const user of users) {
      try {
        await dispatchSystemNotification(
          user.vaultAddress,
          title,
          body || undefined,
          NotificationType.SYSTEM,
        );
        sent++;
      } catch (err) {
        console.error(`Broadcast notification failed for ${user.vaultAddress}:`, err);
      }
    }

    res.json({ success: true, sent, total: users.length });
  } catch (error) {
    console.error('Admin broadcast notification error:', error);
    res.status(500).json({ success: false, error: 'Failed to broadcast notification' });
  }
});

// ─── Earn Tokens (Vaults) ───

/**
 * GET /earn-tokens
 * List all earn tokens with full data.
 */
router.get('/earn-tokens', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string) || '';
    const type = (req.query.type as string) || '';
    const coin = (req.query.coin as string) || '';
    const status = (req.query.status as string) || '';
    const minPoolSizeUsdRaw = req.query.minPoolSizeUsd as string | undefined;
    const maxPoolSizeUsdRaw = req.query.maxPoolSizeUsd as string | undefined;
    const minPoolSizeUsd = minPoolSizeUsdRaw ? parseFloat(minPoolSizeUsdRaw) : null;
    const maxPoolSizeUsd = maxPoolSizeUsdRaw ? parseFloat(maxPoolSizeUsdRaw) : null;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { vaultAddress: { $regex: search, $options: 'i' } },
        { symbol: { $regex: search, $options: 'i' } },
        { vaultTitle: { $regex: search, $options: 'i' } },
        { mint: { $regex: search, $options: 'i' } },
      ];
    }
    const typeList = type.split(',').map((s) => s.trim()).filter(Boolean);
    const coinList = coin.split(',').map((s) => s.trim()).filter(Boolean);
    if (typeList.length === 1) filter.type = typeList[0];
    else if (typeList.length > 1) filter.type = { $in: typeList };
    if (coinList.length === 1) filter.symbol = coinList[0];
    else if (coinList.length > 1) filter.symbol = { $in: coinList };
    if (status) filter.status = status;

    const [rawTokens, allCoins] = await Promise.all([
      EarnTokenModel.find(filter).lean(),
      EarnTokenModel.distinct('symbol'),
    ]);

    const enriched = rawTokens.map((t) => {
      let poolSizeUi: number | null = null;
      let poolSizeUsd: number | null = null;
      try {
        if (t.type === 'jupiter' && t.jupiterToken?.totalAssets) {
          const dec = SUPPORTED_TOKENS_BY_MINT[t.mint]?.decimals ?? 6;
          poolSizeUi = Number(t.jupiterToken.totalAssets) / 10 ** dec;
        } else if (t.type === 'kamino' && t.kaminoToken?.metrics) {
          const avail = Number(t.kaminoToken.metrics.tokensAvailable || 0);
          const invested = Number(t.kaminoToken.metrics.tokensInvested || 0);
          poolSizeUi = avail + invested;
          const usdAvail = Number(t.kaminoToken.metrics.tokensAvailableUsd || 0);
          const usdInvested = Number(t.kaminoToken.metrics.tokensInvestedUsd || 0);
          poolSizeUsd = usdAvail + usdInvested;
        } else if (t.type === 'drift' && t.driftToken?.depositBalance) {
          const bal = Number(t.driftToken.depositBalance);
          const interest = Number(t.driftToken.cumulativeDepositInterest || 1e10);
          poolSizeUi = (bal * interest) / 1e9 / 1e10;
        }
        if (poolSizeUi !== null && poolSizeUsd === null) {
          poolSizeUsd = priceManager.getUsdValue(t.symbol, poolSizeUi);
        }
      } catch {
        // Pool size unavailable
      }

      const decimals = SUPPORTED_TOKENS_BY_MINT[t.mint]?.decimals ?? 6;

      return {
        id: t._id,
        type: t.type,
        vaultAddress: t.vaultAddress,
        vaultTitle: t.vaultTitle,
        mint: t.mint,
        symbol: t.symbol,
        rewardsRate: t.rewardsRate,
        status: t.status,
        minDepositAmount: t.minDepositAmount || '0',
        minWithdrawAmount: t.minWithdrawAmount || '0',
        poolSizeUi,
        poolSizeUsd,
        decimals,
        createdAt: (t as any).createdAt,
        updatedAt: (t as any).updatedAt,
      };
    });

    let sizeFiltered = enriched;
    if (minPoolSizeUsd !== null && !Number.isNaN(minPoolSizeUsd)) {
      sizeFiltered = sizeFiltered.filter((t) => (t.poolSizeUsd ?? 0) >= minPoolSizeUsd);
    }
    if (maxPoolSizeUsd !== null && !Number.isNaN(maxPoolSizeUsd)) {
      sizeFiltered = sizeFiltered.filter((t) => (t.poolSizeUsd ?? 0) <= maxPoolSizeUsd);
    }

    sizeFiltered.sort((a, b) => (b.poolSizeUsd ?? 0) - (a.poolSizeUsd ?? 0));

    const total = sizeFiltered.length;
    const paginated = sizeFiltered.slice((page - 1) * limit, page * limit);

    res.json({
      success: true,
      tokens: paginated,
      coins: allCoins.sort(),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Admin list earn tokens error:', error);
    res.status(500).json({ success: false, error: 'Failed to list earn tokens' });
  }
});

/**
 * PATCH /earn-tokens/:id/status
 * Toggle earn token status between active/inactive.
 */
router.patch('/earn-tokens/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be "active" or "inactive"' });
      return;
    }

    const token = await EarnTokenModel.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );

    if (!token) {
      res.status(404).json({ success: false, error: 'Earn token not found' });
      return;
    }

    res.json({ success: true, status: token.status });
  } catch (error) {
    console.error('Admin update earn token status error:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

/**
 * PATCH /earn-tokens/:id/config
 * Update earn token config (minDepositAmount, minWithdrawAmount).
 */
router.patch('/earn-tokens/:id/config', async (req, res) => {
  try {
    const { minDepositAmount, minWithdrawAmount } = req.body;
    const update: any = {};
    if (minDepositAmount !== undefined) update.minDepositAmount = String(minDepositAmount);
    if (minWithdrawAmount !== undefined) update.minWithdrawAmount = String(minWithdrawAmount);

    if (Object.keys(update).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const token = await EarnTokenModel.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true },
    );

    if (!token) {
      res.status(404).json({ success: false, error: 'Earn token not found' });
      return;
    }

    res.json({
      success: true,
      minDepositAmount: token.minDepositAmount,
      minWithdrawAmount: token.minWithdrawAmount,
    });
  } catch (error) {
    console.error('Admin update earn token config error:', error);
    res.status(500).json({ success: false, error: 'Failed to update config' });
  }
});

// ─── Rewards (admin) ───

/**
 * GET /rewards/tasks
 * List all reward tasks (active and inactive) for the admin dashboard.
 */
router.get('/rewards/tasks', async (_req, res) => {
  try {
    const tasks = await RewardTaskModel.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Admin list reward tasks error:', error);
    res.status(500).json({ success: false, error: 'Failed to list reward tasks' });
  }
});

/**
 * POST /rewards/tasks
 * Create a new reward task.
 */
router.post('/rewards/tasks', async (req, res) => {
  try {
    const {
      slug, title, description, imageUrl, metadataUri,
      active, sortOrder, availableFrom, availableUntil, requiresTaskSlug,
      mintFeeLamports, maxSupply, verifierType, verifierConfig,
    } = req.body;
    if (!slug || !title || !description || !imageUrl || !metadataUri || !verifierType) {
      res.status(400).json({ success: false, error: 'slug, title, description, imageUrl, metadataUri, and verifierType are required' });
      return;
    }
    if (!Object.values(RewardVerifierType).includes(verifierType)) {
      res.status(400).json({ success: false, error: `Invalid verifierType: ${verifierType}` });
      return;
    }

    const task = await RewardTaskModel.create({
      slug,
      title,
      description,
      imageUrl,
      metadataUri,
      active: active !== false,
      sortOrder: Number(sortOrder) || 0,
      availableFrom: availableFrom ? new Date(availableFrom) : undefined,
      availableUntil: availableUntil ? new Date(availableUntil) : undefined,
      requiresTaskSlug: requiresTaskSlug || undefined,
      mintFeeLamports: mintFeeLamports ? String(mintFeeLamports) : '20000000',
      maxSupply: maxSupply != null ? Number(maxSupply) : undefined,
      verifierType,
      verifierConfig: verifierConfig || {},
    });

    res.json({ success: true, task: { id: task._id, slug: task.slug } });
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ success: false, error: 'Slug already exists' });
      return;
    }
    console.error('Admin create reward task error:', error);
    res.status(500).json({ success: false, error: 'Failed to create reward task' });
  }
});

/**
 * PATCH /rewards/tasks/:slug
 * Partial update.
 */
router.patch('/rewards/tasks/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const update: Record<string, any> = {};
    const allowed = [
      'title', 'description', 'imageUrl', 'metadataUri', 'active', 'sortOrder',
      'availableFrom', 'availableUntil', 'requiresTaskSlug', 'mintFeeLamports',
      'maxSupply', 'verifierConfig',
    ];
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }
    if (update.availableFrom) update.availableFrom = new Date(update.availableFrom);
    if (update.availableUntil) update.availableUntil = new Date(update.availableUntil);
    if (update.mintFeeLamports != null) update.mintFeeLamports = String(update.mintFeeLamports);

    const task = await RewardTaskModel.findOneAndUpdate({ slug }, { $set: update }, { new: true });
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    res.json({ success: true, task });
  } catch (error) {
    console.error('Admin patch reward task error:', error);
    res.status(500).json({ success: false, error: 'Failed to update reward task' });
  }
});

/**
 * POST /rewards/manual-verify
 * Body: { vaultAddress, taskSlug }
 * Marks a manual-verifier progress entry as approved (sets attestations.manualApprovedAt).
 */
router.post('/rewards/manual-verify', async (req, res) => {
  try {
    const { vaultAddress, taskSlug } = req.body;
    if (!vaultAddress || !taskSlug) {
      res.status(400).json({ success: false, error: 'vaultAddress and taskSlug are required' });
      return;
    }

    const task = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    await UserRewardProgressModel.findOneAndUpdate(
      { vaultAddress, taskSlug },
      {
        $set: {
          'attestations.manualApprovedAt': new Date(),
          status: RewardProgressStatus.CLAIMABLE,
          currentValue: '1',
          targetValue: '1',
          completedAt: new Date(),
          lastEvaluatedAt: new Date(),
        },
        $setOnInsert: { vaultAddress, taskSlug },
      },
      { upsert: true },
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Admin manual-verify reward error:', error);
    res.status(500).json({ success: false, error: 'Failed to manual-verify' });
  }
});

/**
 * GET /rewards/badges?taskSlug=&status=
 * Browse minted badges.
 */
router.get('/rewards/badges', async (req, res) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.taskSlug) filter.taskSlug = req.query.taskSlug;
    if (req.query.status) filter.status = req.query.status;

    const badges = await MintedBadgeModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json({ success: true, badges });
  } catch (error) {
    console.error('Admin list minted badges error:', error);
    res.status(500).json({ success: false, error: 'Failed to list badges' });
  }
});

/**
 * GET /rewards/settings
 * Returns runtime-configurable reward settings (collection address + env defaults).
 */
router.get('/rewards/settings', async (_req, res) => {
  try {
    const collectionAddress = await getSetting(
      APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS,
      process.env.REWARDS_COLLECTION_ADDRESS ?? null,
    );
    res.json({
      success: true,
      settings: {
        rewardsCollectionAddress: collectionAddress,
        envDefaultCollectionAddress: process.env.REWARDS_COLLECTION_ADDRESS ?? null,
        treasuryWallet: process.env.TREASURY_WALLET_ADDRESS ?? null,
        cdnBaseUrl: process.env.DO_SPACES_CDN_URL ?? null,
        storageConfigured: storage.isConfigured(),
      },
    });
  } catch (error) {
    console.error('Admin get reward settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

/**
 * PUT /rewards/settings
 * Body: { rewardsCollectionAddress?: string }
 * Updates runtime settings. Set to empty string to clear (env fallback applies).
 */
router.put('/rewards/settings', async (req, res) => {
  try {
    const { rewardsCollectionAddress } = req.body ?? {};
    if (typeof rewardsCollectionAddress === 'string') {
      const trimmed = rewardsCollectionAddress.trim();
      if (trimmed.length === 0) {
        // Treat empty as "fall back to env" — store empty string so we know admin opted in
        await setSetting(APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS, '');
      } else {
        // Light validation: base58 32-44 chars
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
          res.status(400).json({ success: false, error: 'Invalid Solana address format' });
          return;
        }
        await setSetting(APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS, trimmed);
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update reward settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// ─── Reward asset uploads (DigitalOcean Spaces) ───

const rewardImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
  },
});

/**
 * POST /rewards/upload-image
 * Multipart form with field "image". Optional "slug" for stable filenames.
 * Returns { url } for use as RewardTask.imageUrl or inside metadata JSON.
 */
router.post('/rewards/upload-image', rewardImageUpload.single('image'), async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      res.status(503).json({ success: false, error: 'Storage is not configured' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Image file is required' });
      return;
    }

    const slug = (req.body?.slug ?? '').toString().trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);
    const ext =
      req.file.mimetype === 'image/png' ? 'png' :
      req.file.mimetype === 'image/webp' ? 'webp' :
      req.file.mimetype === 'image/gif' ? 'gif' : 'jpg';

    const filename = slug ? `${slug}.${ext}` : `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const key = `rewards/badges/${filename}`;
    const url = await storage.uploadFile(req.file.buffer, key, req.file.mimetype);

    res.json({ success: true, url, key });
  } catch (error: any) {
    if (error?.message?.includes('Only JPEG')) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    console.error('Admin upload reward image error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload image' });
  }
});

/**
 * POST /rewards/create-collection
 * Body: { name, description, imageUrl, externalUrl?, metadata? }
 * One-shot: uploads collection metadata JSON to DO Spaces, runs Metaplex Core
 * createCollection on-chain (admin keypair signs), saves the resulting collection
 * address into AppSettings, and returns { address, metadataUri, signature }.
 *
 * If `metadata` (object) is provided, it overrides the auto-generated JSON.
 */
router.post('/rewards/create-collection', async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      res.status(503).json({ success: false, error: 'Storage is not configured' });
      return;
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      res.status(503).json({ success: false, error: 'SOLANA_RPC_URL not configured' });
      return;
    }

    const { name, description, imageUrl, externalUrl, metadata } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }

    // Build / accept the metadata JSON
    const metadataObj = (metadata && typeof metadata === 'object')
      ? metadata
      : {
          name,
          description: description ?? '',
          image: imageUrl ?? '',
          ...(externalUrl ? { external_url: externalUrl } : {}),
        };

    // Upload metadata to DO Spaces under /rewards/metadata/collection.json
    const metadataKey = `rewards/metadata/collection.json`;
    const metadataUri = await storage.uploadFile(
      Buffer.from(JSON.stringify(metadataObj, null, 2), 'utf-8'),
      metadataKey,
      'application/json',
    );

    // Run Metaplex Core createCollection server-side
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { keypairIdentity, generateSigner } = await import('@metaplex-foundation/umi');
    const { mplCore, createCollection } = await import('@metaplex-foundation/mpl-core');
    const { getAdminTxFeePayerKeypair } = await import('../services/adminFeePayer');

    const umi = createUmi(rpcUrl).use(mplCore());
    const adminKeypair = getAdminTxFeePayerKeypair();
    const umiAdminKeypair = umi.eddsa.createKeypairFromSecretKey(adminKeypair.secretKey);
    umi.use(keypairIdentity(umiAdminKeypair));

    const collectionSigner = generateSigner(umi);

    const result = await createCollection(umi, {
      collection: collectionSigner,
      name,
      uri: metadataUri,
      plugins: [],
    }).sendAndConfirm(umi);

    const address = collectionSigner.publicKey.toString();
    const signature = Buffer.from(result.signature).toString('base64');

    // Save into AppSetting so RewardMintBuilder + /config pick it up immediately
    await setSetting(APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS, address);

    res.json({ success: true, address, metadataUri, signature });
  } catch (error: any) {
    console.error('Admin create-collection error:', error);
    res.status(500).json({ success: false, error: error?.message ?? 'Failed to create collection' });
  }
});

/**
 * POST /rewards/upload-metadata
 * Body: { slug: string, metadata: object }
 * Uploads the metadata JSON to DO Spaces under /rewards/metadata/<slug>.json.
 * Returns { url } for use as RewardTask.metadataUri.
 */
router.post('/rewards/upload-metadata', async (req, res) => {
  try {
    if (!storage.isConfigured()) {
      res.status(503).json({ success: false, error: 'Storage is not configured' });
      return;
    }
    const { slug, metadata } = req.body ?? {};
    if (!slug || typeof slug !== 'string') {
      res.status(400).json({ success: false, error: 'slug is required' });
      return;
    }
    if (!metadata || typeof metadata !== 'object') {
      res.status(400).json({ success: false, error: 'metadata object is required' });
      return;
    }
    const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);
    if (!safeSlug) {
      res.status(400).json({ success: false, error: 'Invalid slug' });
      return;
    }
    const buffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8');
    const key = `rewards/metadata/${safeSlug}.json`;
    const url = await storage.uploadFile(buffer, key, 'application/json');
    res.json({ success: true, url, key });
  } catch (error) {
    console.error('Admin upload reward metadata error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload metadata' });
  }
});

export default router;
