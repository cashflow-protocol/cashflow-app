import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { InviteCodeModel, WaitlistUserModel } from '../models';

const router = Router();

// ─── Auth middleware ───

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
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

export default router;
