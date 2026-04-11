import { UserModel, DeviceTokenModel, NotificationType, TransactionStatus } from '../models';
import { DBManager } from '../managers';
import { parseTransaction } from './transactionParser';
import { sendPushNotification, writeNotificationToRTDB } from './firebaseManager';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants/tokens';
import { updateCostBasisOnConfirm } from './feeService';
import type { HeliusEnhancedTransaction } from './transactionParser';

async function getFcmTokensForUser(userId: string): Promise<string[]> {
  const devices = await DeviceTokenModel.find({ userId }).select('fcmToken').lean();
  return devices.map((d) => d.fcmToken);
}

const dbManager = new DBManager();

const PROTOCOL_LABELS: Record<string, string> = {
  jupiter: 'Jupiter Lend',
  kamino: 'Kamino',
  drift: 'Drift',
};

/**
 * Try to match a transaction against a known deposit/withdraw in MongoDB.
 * First tries by signature/bundle, then falls back to the most recent CREATED
 * transaction for this wallet (handles the race where the Helius webhook arrives
 * before bundle signatures are stored).
 */
async function tryMatchStoredTransaction(
  tx: HeliusEnhancedTransaction,
  walletAddress?: string,
): Promise<{ title: string; type: NotificationType; transactionId: string } | null> {
  let record = await dbManager.findTransactionBySignature(tx.signature);

  // Fallback: webhook arrived before bundle signatures were submitted.
  // Look for a recent CREATED record for this user's wallet.
  if (!record && walletAddress) {
    record = await dbManager.findRecentCreatedTransaction(walletAddress);
  }

  if (!record) return null;

  const token = SUPPORTED_TOKENS_BY_MINT[record.mint];
  const symbol = token?.symbol || record.mint.slice(0, 6) + '...';
  const decimals = token?.decimals ?? 6;
  const uiAmount = (Number(record.amount) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const protocol = record.type ? (PROTOCOL_LABELS[record.type] || record.type) : '';

  let title: string;
  let notifType: NotificationType;

  if (record.action === 'deposit') {
    title = `Deposited ${uiAmount} ${symbol} into ${protocol}`;
    notifType = NotificationType.DEPOSIT;
  } else if (record.action === 'withdraw') {
    title = `Withdrawn ${uiAmount} ${symbol} from ${protocol}`;
    notifType = NotificationType.WITHDRAW;
  } else {
    return null;
  }

  // Mark the transaction as confirmed (also store signature if it was a fallback match)
  await dbManager.confirmTransaction(String(record._id), TransactionStatus.CONFIRMED, tx.signature);
  await updateCostBasisOnConfirm(String(record._id));

  return { title, type: notifType, transactionId: String(record._id) };
}

export async function dispatchOnchainNotification(
  vaultAddress: string,
  tx: HeliusEnhancedTransaction,
): Promise<void> {
  const user = await UserModel.findOne({ vaultAddress }).lean();
  if (!user) return;

  // Try to match against a stored deposit/withdraw first
  const matched = await tryMatchStoredTransaction(tx, (user as any).publicKey);

  let title: string;
  let body: string | undefined;
  let notifType: NotificationType;
  let metadata: Record<string, any> | undefined;

  if (matched) {
    title = matched.title;
    notifType = matched.type;
    metadata = { transactionId: matched.transactionId };
  } else {
    // If this signature belongs to a known bundle but wasn't the primary match,
    // skip it — the primary transaction already generated the notification.
    const inBundle = await dbManager.isSignatureInBundle(tx.signature);
    if (inBundle) return;

    // Fall back to parsing the Helius transaction data
    const parsed = parseTransaction(tx, vaultAddress);
    if (!parsed) return;
    title = parsed.title;
    body = parsed.body;
    notifType = parsed.type;
    metadata = parsed.metadata;
  }

  let notificationDoc;
  try {
    notificationDoc = await dbManager.createNotification({
      userId: String(user._id),
      vaultAddress,
      title,
      body,
      type: notifType,
      txSignature: tx.signature,
      metadata,
    });
  } catch (error: any) {
    // Duplicate txSignature — already notified
    if (error?.code === 11000) return;
    throw error;
  }

  console.log(`📨 ${title} (${vaultAddress.slice(0, 8)}...)`);

  const userId = String(user._id);
  const fcmTokens = await getFcmTokensForUser(userId);

  await Promise.all([
    writeNotificationToRTDB(userId, String(notificationDoc._id), { title, body, type: notifType }),
    fcmTokens.length
      ? sendPushNotification(fcmTokens, title, body || '', { type: notifType, vaultAddress, txSignature: tx.signature })
      : Promise.resolve(),
  ]);
}

export async function dispatchSystemNotification(
  vaultAddress: string,
  title: string,
  body?: string,
  type: NotificationType = NotificationType.SYSTEM,
): Promise<void> {
  const user = await UserModel.findOne({ vaultAddress }).lean();
  if (!user) return;

  const notificationDoc = await dbManager.createNotification({
    userId: String(user._id),
    vaultAddress,
    title,
    body,
    type,
  });

  const userId = String(user._id);
  const fcmTokens = await getFcmTokensForUser(userId);

  await Promise.all([
    writeNotificationToRTDB(userId, String(notificationDoc._id), { title, body, type }),
    fcmTokens.length
      ? sendPushNotification(fcmTokens, title, body || '', { type, vaultAddress })
      : Promise.resolve(),
  ]);
}
