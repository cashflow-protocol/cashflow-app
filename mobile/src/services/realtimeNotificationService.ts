import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import apiService from './apiService';

export type NotificationCallback = (
  title: string,
  body: string,
  data: { type: string },
) => void;

let unsubscribe: (() => void) | null = null;
let authenticated = false;

export async function initializeRealtimeNotifications(
  onNotification: NotificationCallback,
): Promise<void> {
  // Already listening
  if (unsubscribe) return;

  try {
    const { firebaseToken, userId } = await apiService.getFirebaseToken();

    await auth().signInWithCustomToken(firebaseToken);
    authenticated = true;

    const ref = database().ref(`/notifications/${userId}`);

    // Only listen for new notifications added after we connect
    const listener = ref
      .orderByChild('createdAt')
      .startAt(Date.now())
      .on('child_added', (snapshot) => {
        const val = snapshot.val();
        if (val?.title) {
          onNotification(val.title, val.body || '', { type: val.type });
          // Clean up after processing
          snapshot.ref.remove().catch(() => {});
        }
      });

    unsubscribe = () => {
      ref.off('child_added', listener);
    };

    console.log('[RTDB] Realtime notifications initialized');
  } catch (error) {
    console.error('[RTDB] Init error:', error);
  }
}

export function stopRealtimeNotifications(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (authenticated) {
    auth().signOut().catch(() => {});
    authenticated = false;
  }
}
