import admin from 'firebase-admin';
import { UserModel, WaitlistUserModel } from '../models';

let initialized = false;

export function initializeFirebase(): void {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not set, push notifications disabled');
    return;
  }

  try {
    const serviceAccount = JSON.parse(Buffer.from(key, 'base64').toString());
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log(`✅ Firebase Admin initialized (project: ${serviceAccount.project_id}, client_email: ${serviceAccount.client_email})`);
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
  }
}

export async function sendPushNotification(
  fcmTokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!initialized || fcmTokens.length === 0) return;

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens: fcmTokens,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    };

    console.log(`📱 Sending to ${fcmTokens.length} token(s), first token prefix: ${fcmTokens[0]?.slice(0, 20)}...`);
    const response = await admin.messaging().sendEachForMulticast(message);
    const succeeded = response.responses.filter((r) => r.success).length;
    const failed = response.responses.filter((r) => !r.success).length;
    if (failed > 0) {
      response.responses.forEach((resp, idx) => {
        if (resp.error) {
          console.warn(`📱 Push failed [${idx}]: ${resp.error.code} - ${resp.error.message}`);
        }
      });
    } else {
      console.log(`📱 Push: ${succeeded} ok`);
    }

    // Remove invalid tokens
    const tokensToRemove: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (resp.error?.code === 'messaging/registration-token-not-registered' ||
          resp.error?.code === 'messaging/invalid-registration-token' ||
          resp.error?.code === 'messaging/mismatched-credential') {
        tokensToRemove.push(fcmTokens[idx]);
      }
    });

    if (tokensToRemove.length > 0) {
      await UserModel.updateMany(
        { fcmTokens: { $in: tokensToRemove } },
        { $pullAll: { fcmTokens: tokensToRemove } },
      );
      console.log(`Removed ${tokensToRemove.length} invalid FCM tokens`);
    }
  } catch (error) {
    console.error('Push notification error:', error);
  }
}

export async function sendWaitlistPushNotification(
  publicKey: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!initialized) return;

  const user = await WaitlistUserModel.findOne({ publicKey }).lean();
  if (!user?.fcmTokens?.length) return;

  try {
    const message: admin.messaging.MulticastMessage = {
      tokens: user.fcmTokens,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    const tokensToRemove: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (resp.error?.code === 'messaging/registration-token-not-registered' ||
          resp.error?.code === 'messaging/invalid-registration-token') {
        tokensToRemove.push(user.fcmTokens[idx]);
      }
    });

    if (tokensToRemove.length > 0) {
      await WaitlistUserModel.updateOne(
        { publicKey },
        { $pullAll: { fcmTokens: tokensToRemove } },
      );
    }
  } catch (error) {
    console.error('Waitlist push notification error:', error);
  }
}
