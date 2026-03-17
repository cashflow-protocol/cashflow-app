import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import type { AppNotification } from '../types/notification';

// Module-level cache — persists across tab switches
let cachedNotifications: AppNotification[] | null = null;
let cachedUnreadCount: number | null = null;

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(cachedNotifications ?? []);
  const [unreadCount, setUnreadCount] = useState(cachedUnreadCount ?? 0);
  const [loading, setLoading] = useState(cachedNotifications === null);
  const [hasMore, setHasMore] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [historyRes, count] = await Promise.all([
        apiService.getNotificationHistory({ limit: 20 }),
        apiService.getUnreadNotificationCount(),
      ]);

      cachedNotifications = historyRes.notifications;
      cachedUnreadCount = count;
      setNotifications(historyRes.notifications);
      setUnreadCount(count);
      setHasMore(historyRes.hasMore);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedNotifications === null) {
      fetchData();
    }
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(), [fetchData]);

  const loadMore = useCallback(async () => {
    if (!hasMore || notifications.length === 0) return;

    const lastId = notifications[notifications.length - 1]._id;
    try {
      const res = await apiService.getNotificationHistory({ limit: 20, before: lastId });
      const combined = [...notifications, ...res.notifications];
      cachedNotifications = combined;
      setNotifications(combined);
      setHasMore(res.hasMore);
    } catch (err) {
      console.error('Failed to load more notifications:', err);
    }
  }, [hasMore, notifications]);

  const markAsRead = useCallback(async (notificationIds: string[]) => {
    try {
      await apiService.markNotificationsRead(notificationIds);

      const updated = notifications.map((n) =>
        notificationIds.includes(n._id) ? { ...n, read: true } : n,
      );
      cachedNotifications = updated;
      setNotifications(updated);

      const newUnread = Math.max(0, unreadCount - notificationIds.length);
      cachedUnreadCount = newUnread;
      setUnreadCount(newUnread);
    } catch (err) {
      console.error('Failed to mark notifications as read:', err);
    }
  }, [notifications, unreadCount]);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await apiService.getUnreadNotificationCount();
      cachedUnreadCount = count;
      setUnreadCount(count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, []);

  return { notifications, loading, unreadCount, hasMore, loadMore, markAsRead, refresh, refreshUnreadCount };
}
