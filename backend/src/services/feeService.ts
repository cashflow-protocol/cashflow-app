import { UserCostBasisModel, FeeTransactionModel, FeeTransactionStatus, FeeType, TransactionModel, TransactionAction, UserRewardProgressModel, RewardProgressStatus } from '../models';

/**
 * Record a vault creation fee payment.
 */
export async function createVaultCreationFeeRecord(params: {
  vaultAddress: string;
  feeAmount: string;
  signature: string;
}): Promise<void> {
  await FeeTransactionModel.create({
    vaultAddress: params.vaultAddress,
    mint: 'So11111111111111111111111111111111111111112', // native SOL
    feeType: FeeType.VAULT_CREATION,
    feeAmount: params.feeAmount,
    signature: params.signature,
    status: FeeTransactionStatus.CONFIRMED,
  });
}

/**
 * Atomically increment a string-typed BigInt counter on a UserCostBasis doc
 * using compare-and-swap. The field stays a string (BigInt-safe), so MongoDB's
 * native $inc isn't usable — we retry on lost updates instead.
 */
async function casIncrementCostBasis(
  vaultAddress: string,
  mint: string,
  increments: Partial<Record<'totalDeposited' | 'totalWithdrawn', bigint>>,
): Promise<void> {
  const fields = Object.keys(increments) as Array<keyof typeof increments>;

  for (let attempt = 0; attempt < 10; attempt++) {
    const doc = await UserCostBasisModel.findOneAndUpdate(
      { vaultAddress, mint },
      { $setOnInsert: { totalDeposited: '0', totalWithdrawn: '0' } },
      { upsert: true, new: true },
    ).lean();

    const filter: Record<string, unknown> = { vaultAddress, mint };
    const setFields: Record<string, string> = {};
    for (const field of fields) {
      const currentStr = (doc as unknown as Record<string, string>)[field] ?? '0';
      filter[field] = currentStr;
      setFields[field] = (BigInt(currentStr) + (increments[field] ?? 0n)).toString();
    }

    const result = await UserCostBasisModel.updateOne(filter, { $set: setFields });
    if (result.matchedCount === 1) return;
  }

  throw new Error(`casIncrementCostBasis: exceeded retries for ${vaultAddress}/${mint}`);
}

/**
 * Run all post-confirm side effects for a transaction: cost basis updates and
 * reward verifier cache invalidation. Called from both the scheduler poll and
 * the Helius webhook path so behavior stays in sync.
 */
export async function onTransactionConfirmed(transactionId: string): Promise<void> {
  const tx = await TransactionModel.findById(transactionId).lean();
  if (!tx) return;

  const { userVaultAddress, mint, amount, action } = tx;

  if (!userVaultAddress) return;

  if (action === TransactionAction.DEPOSIT) {
    await casIncrementCostBasis(userVaultAddress, mint, { totalDeposited: BigInt(amount) });
  } else if (action === TransactionAction.WITHDRAW) {
    await casIncrementCostBasis(userVaultAddress, mint, { totalWithdrawn: BigInt(amount) });
  }

  // Invalidate reward verifier TTL cache so the next read re-evaluates
  // progress against the freshly-confirmed transaction.
  await UserRewardProgressModel.updateMany(
    { vaultAddress: userVaultAddress, status: RewardProgressStatus.IN_PROGRESS },
    { $unset: { lastEvaluatedAt: '' } },
  ).catch((err) => console.error('[onTransactionConfirmed] reward cache invalidation error:', err));
}

/** @deprecated use onTransactionConfirmed */
export const updateCostBasisOnConfirm = onTransactionConfirmed;
