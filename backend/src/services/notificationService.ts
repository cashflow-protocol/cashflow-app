import { UserModel, NotificationType } from '../models';
import { DBManager } from '../managers';
import { parseTransaction } from './transactionParser';
import { sendPushNotification } from './firebaseManager';
import type { HeliusEnhancedTransaction } from './transactionParser';

const dbManager = new DBManager();

export async function dispatchOnchainNotification(
  vaultAddress: string,
  tx: HeliusEnhancedTransaction,
): Promise<void> {
  const parsed = parseTransaction(tx, vaultAddress);
  if (!parsed) {
    console.log(`⚠️ parseTransaction returned null for ${tx.signature?.slice(0, 8)}... vault=${vaultAddress.slice(0, 8)}...`);
    console.log(`   type=${tx.type} source=${tx.source} tokenTransfers=${tx.tokenTransfers?.length ?? 'undefined'} nativeTransfers=${tx.nativeTransfers?.length ?? 'undefined'}`);
    if (tx.nativeTransfers?.length) {
      for (const nt of tx.nativeTransfers) {
        console.log(`   native: ${nt.fromUserAccount?.slice(0, 8)}... → ${nt.toUserAccount?.slice(0, 8)}... amount=${nt.amount}`);
      }
    }
    return;
  }

  console.log(`✅ Parsed: "${parsed.title}" (${parsed.type}) for ${vaultAddress.slice(0, 8)}...`);

  const user = await UserModel.findOne({ vaultAddress }).lean();
  if (!user) {
    console.log(`⚠️ No user found for vault ${vaultAddress.slice(0, 8)}...`);
    return;
  }

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
    console.log(`💾 Notification saved for ${tx.signature?.slice(0, 8)}...`);
  } catch (error: any) {
    // Duplicate txSignature — already notified
    if (error?.code === 11000) {
      console.log(`⏭️ Duplicate tx ${tx.signature?.slice(0, 8)}..., skipping`);
      return;
    }
    throw error;
  }

  if (user.fcmTokens?.length) {
    console.log(`📱 Sending push to ${user.fcmTokens.length} device(s) for "${parsed.title}"`);
    await sendPushNotification(
      user.fcmTokens,
      parsed.title,
      parsed.body || '',
      { type: parsed.type, vaultAddress, txSignature: parsed.txSignature },
    );
  } else {
    console.log(`⚠️ No FCM tokens for user ${vaultAddress.slice(0, 8)}..., skipping push`);
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

  if (user.fcmTokens?.length) {
    await sendPushNotification(
      user.fcmTokens,
      title,
      body || '',
      { type, vaultAddress },
    );
  }
}
