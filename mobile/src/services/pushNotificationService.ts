import messaging from '@react-native-firebase/messaging';
import { Platform, PermissionsAndroid } from 'react-native';
import apiService from './apiService';

export async function initializePushNotifications(): Promise<void> {
  try {
    // Request permission (required on iOS, Android 13+)
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      console.log('Push notification permission denied');
      return;
    }

    const fcmToken = await messaging().getToken();
    await apiService.registerDeviceToken(fcmToken);

    // Listen for token refresh
    messaging().onTokenRefresh(async (newToken) => {
      try {
        await apiService.registerDeviceToken(newToken);
      } catch (error) {
        console.error('FCM token refresh registration failed:', error);
      }
    });
  } catch (error) {
    console.error('Push notification initialization failed:', error);
  }
}

/**
 * Set up foreground message handler.
 * Returns an unsubscribe function.
 */
export function setupForegroundHandler(
  onNotification: (title: string, body: string) => void,
): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    const title = remoteMessage.notification?.title || '';
    const body = remoteMessage.notification?.body || '';
    if (title) {
      onNotification(title, body);
    }
  });
}
