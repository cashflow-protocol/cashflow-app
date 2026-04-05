import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useNotifications } from '../hooks/useNotifications';
import type { AppNotification } from '../types/notification';
import { logScreenView, logNotificationPress, logNotificationLoadMore } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface NotificationsScreenProps {
  onBack: () => void;
}

function BackArrow({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M19 12H5m0 0l7 7m-7-7l7-7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function getNotificationIcon(type: string): { color: string; icon: string } {
  switch (type) {
    case 'transfer_in':
      return { color: '#28A745', icon: 'in' };
    case 'transfer_out':
      return { color: '#DC3545', icon: 'out' };
    case 'deposit':
      return { color: '#3985D8', icon: 'out' };
    case 'withdraw':
      return { color: '#E67E22', icon: 'in' };
    case 'waitlist_approved':
      return { color: '#28A745', icon: 'star' };
    default:
      return { color: '#6B7280', icon: 'bell' };
  }
}

function NotificationIcon({ type }: { type: string }) {
  const { color, icon } = getNotificationIcon(type);

  return (
    <View style={[styles.iconCircle, { backgroundColor: color + '18' }]}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        {icon === 'in' ? (
          <Path d="M12 5v14m0 0l-7-7m7 7l7-7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : icon === 'out' ? (
          <Path d="M12 19V5m0 0l-7 7m7-7l7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : icon === 'star' ? (
          <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </Svg>
    </View>
  );
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function NotificationItem({
  notification,
  onPress,
  colors,
}: {
  notification: AppNotification;
  onPress: () => void;
  colors: any;
}) {
  return (
    <TouchableOpacity style={[styles.notificationRow, { backgroundColor: colors.card }]} activeOpacity={0.7} onPress={onPress}>
      <NotificationIcon type={notification.type} />
      <View style={styles.notificationContent}>
        <Text style={[styles.notificationTitle, { color: colors.textPrimary }, !notification.read && styles.unreadTitle]}>
          {notification.title}
        </Text>
        {notification.body ? (
          <Text style={[styles.notificationBody, { color: colors.textSecondary }]} numberOfLines={2}>
            {notification.body}
          </Text>
        ) : null}
        <Text style={[styles.notificationTime, { color: colors.textTertiary }]}>{formatTimeAgo(notification.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen({ onBack }: NotificationsScreenProps) {
  const { colors } = useTheme();
  const { notifications, loading, hasMore, loadMore, markAsRead, refresh } = useNotifications();

  useEffect(() => { logScreenView('NotificationsScreen'); }, []);

  // Mark all notifications as read when the screen opens
  useEffect(() => {
    if (loading) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n._id);
    if (unreadIds.length > 0) {
      markAsRead(unreadIds);
    }
  }, [loading]); // Only run once after initial load

  const handlePress = useCallback(
    (notification: AppNotification) => {
      logNotificationPress(notification.type, notification.read);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationItem notification={item} onPress={() => handlePress(item)} colors={colors} />
    ),
    [handlePress, colors],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <BackArrow color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Notifications</Text>
        <View style={styles.backButton} />
      </SafeAreaView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accentBlue} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centered}>
          <Svg width={48} height={48} viewBox="0 0 24 24" fill="none" style={{ marginBottom: 12 }}>
            <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke={colors.textTertiary} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>No notifications yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textTertiary }]}>We'll notify you about transactions{'\n'}and important updates</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor="#fff" colors={['#fff']} />}
          onEndReached={hasMore ? () => { logNotificationLoadMore(); loadMore(); } : undefined}
          onEndReachedThreshold={0.3}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 120,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  unreadTitle: {
    fontWeight: '700',
  },
  notificationBody: {
    fontSize: 13,
    marginTop: 2,
  },
  notificationTime: {
    fontSize: 12,
    marginTop: 4,
  },
});
