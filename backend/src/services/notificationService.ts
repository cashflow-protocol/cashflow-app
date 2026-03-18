import { UserModel, DeviceTokenModel, NotificationType } from '../models';
import { DBManager } from '../managers';
import { parseTransaction } from './transactionParser';
import { sendPushNotification } from './firebaseManager';
import type { HeliusEnhancedTransaction } from './transactionParser';

async function getFcmTokensForUser(userId: string): Promise<string[]> {
  const devices = await DeviceTokenModel.find({ userId }).select('fcmToken').lean();
  return devices.map((d) => d.fcmToken);
}

const dbManager = new DBManager();

export async function dispatchOnchainNotification(
  vaultAddress: string,
  tx: HeliusEnhancedTransaction,
): Promise<void> {
  const parsed = parseTransaction(tx, vaultAddress);
  if (!parsed) return;

  const user = await UserModel.findOne({ vaultAddress }).lean();
  if (!user) return;

  try {
    await dbManager.createNotification({
      userId: String(user._id),
      vaultAddress,
      title: parsed.title,
      body: parsed.body,
      type: parsed.type,
      txSignature: parsed.txSignature,
      metadata: parsed.metadata,
    });
  } catch (error: any) {
    // Duplicate txSignature — already notified
    if (error?.code === 11000) return;
    throw error;
  }

  console.log(`📨 ${parsed.title} (${vaultAddress.slice(0, 8)}...)`);

  const fcmTokens = await getFcmTokensForUser(String(user._id));
  if (fcmTokens.length) {
    await sendPushNotification(
      fcmTokens,
      parsed.title,
      parsed.body || '',
      { type: parsed.type, vaultAddress, txSignature: parsed.txSignature },
    );
  }
}

export async function dispatchSystemNotification(
  vaultAddress: string,
  title: string,
  body?: string,
  type: NotificationType = NotificationType.SYSTEM,
): Promise<void> {
  const user = await UserModel.findOne({ vaultAddress }).lean();
  if (!user) return;

  await dbManager.createNotification({
    userId: String(user._id),
    vaultAddress,
    title,
    body,
    type,
  });

  const fcmTokens = await getFcmTokensForUser(String(user._id));
  if (fcmTokens.length) {
    await sendPushNotification(
      fcmTokens,
      title,
      body || '',
      { type, vaultAddress },
    );
  }
}
