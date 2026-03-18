import { Router } from 'express';
import { UserModel, DeviceTokenModel } from '../models';
import { DBManager } from '../managers';

const router = Router();
const dbManager = new DBManager();

/**
 * POST /register-device
 * Register an FCM token for push notifications.
 */
router.post('/register-device', async (req, res) => {
  try {
    const { fcmToken, deviceId } = req.body;
    if (!fcmToken || typeof fcmToken !== 'string') {
      res.status(400).json({ success: false, error: 'fcmToken is required' });
      return;
    }
    if (!deviceId || typeof deviceId !== 'string') {
      res.status(400).json({ success: false, error: 'deviceId is required' });
      return;
    }

    const user = await UserModel.findOne({ vaultAddress: (req as any).user.vaultAddress }).lean();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Upsert: one token per device per user
    await DeviceTokenModel.findOneAndUpdate(
      { userId: String(user._id), deviceId },
      { fcmToken },
      { upsert: true },
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({ success: false, error: 'Failed to register device' });
  }
});

/**
 * GET /history
 * Get paginated notification history for the authenticated user.
 */
router.get('/history', async (req, res) => {
  try {
    const vaultAddress = (req as any).user.vaultAddress;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const before = req.query.before as string | undefined;

    const results = await dbManager.getNotifications(vaultAddress, limit, before);
    const hasMore = results.length > limit;
    const notifications = hasMore ? results.slice(0, limit) : results;

    res.json({ success: true, notifications, hasMore });
  } catch (error) {
    console.error('Notification history error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

/**
 * POST /mark-read
 * Mark specific notifications as read.
 */
router.post('/mark-read', async (req, res) => {
  try {
    const { notificationIds } = req.body;
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      res.status(400).json({ success: false, error: 'notificationIds array is required' });
      return;
    }

    const vaultAddress = (req as any).user.vaultAddress;
    await dbManager.markNotificationsRead(vaultAddress, notificationIds);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notifications as read' });
  }
});

/**
 * GET /unread-count
 * Get count of unread notifications.
 */
router.get('/unread-count', async (req, res) => {
  try {
    const vaultAddress = (req as any).user.vaultAddress;
    const count = await dbManager.getUnreadCount(vaultAddress);
    res.json({ success: true, count });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ success: false, error: 'Failed to get unread count' });
  }
});

export default router;
