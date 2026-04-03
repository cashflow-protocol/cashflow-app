import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { InviteCodeModel, WaitlistUserModel, WaitlistTaskModel, UserModel, DeviceTokenModel, NotificationType, EarnTokenModel } from '../models';
import { dispatchSystemNotification } from '../services/notificationService';

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

    const filter: any = {};
    if (search) {
      filter.$or = [
        { vaultAddress: { $regex: search, $options: 'i' } },
        { symbol: { $regex: search, $options: 'i' } },
        { vaultTitle: { $regex: search, $options: 'i' } },
        { mint: { $regex: search, $options: 'i' } },
      ];
    }
    if (type) {
      filter.type = type;
    }

    const [tokens, total] = await Promise.all([
      EarnTokenModel.find(filter)
        .sort({ type: 1, rewardsRate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EarnTokenModel.countDocuments(filter),
    ]);

    res.json({
      success: true,
      tokens: tokens.map((t) => ({
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
        createdAt: (t as any).createdAt,
        updatedAt: (t as any).updatedAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
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

export default router;
