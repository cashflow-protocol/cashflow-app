import { UserCostBasisModel, FeeTransactionModel, FeeTransactionStatus, TransactionModel, TransactionAction } from '../models';
import { TransferManager } from '../managers/TransferManager';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import type { SerializedInstruction } from '../types';

const FEE_RATE_NUMERATOR = 10n;
const FEE_RATE_DENOMINATOR = 100n;

const TREASURY_WALLET_ADDRESS = process.env.TREASURY_WALLET_ADDRESS;

const transferManager = new TransferManager();

export interface FeeCalculation {
  feeAmount: bigint;
  profitAmount: bigint;
}

/**
 * Calculate the 10% profit fee for a withdrawal.
 * Uses running cost basis: profit = cumulative_withdrawn - cumulative_deposited.
 * Only charges fee on the marginal profit of this specific withdrawal.
 */
export async function calculateFee(
  walletAddress: string,
  mint: string,
  withdrawAmount: string,
): Promise<FeeCalculation> {
  const costBasis = await UserCostBasisModel.findOne({ walletAddress, mint }).lean();

  const totalDeposited = BigInt(costBasis?.totalDeposited ?? '0');
  const totalWithdrawn = BigInt(costBasis?.totalWithdrawn ?? '0');
  const withdrawAmountBig = BigInt(withdrawAmount);

  const newTotalWithdrawn = totalWithdrawn + withdrawAmountBig;

  // Total cumulative profit after this withdrawal
  const totalProfit = newTotalWithdrawn > totalDeposited ? newTotalWithdrawn - totalDeposited : 0n;

  // Cumulative profit before this withdrawal
  const previousProfit = totalWithdrawn > totalDeposited ? totalWithdrawn - totalDeposited : 0n;

  // Marginal profit attributable to this withdrawal
  const marginalProfit = totalProfit - previousProfit;

  // 10% fee, integer division rounds down (favors user)
  const feeAmount = (marginalProfit * FEE_RATE_NUMERATOR) / FEE_RATE_DENOMINATOR;

  return { feeAmount, profitAmount: marginalProfit };
}

/**
 * Build transfer instructions to send the fee from user wallet to treasury.
 * Reuses TransferManager which handles SOL, SPL, and Token-2022.
 */
export async function buildFeeTransferInstructions(
  mint: string,
  feeAmount: string,
  ownerAddress: string,
): Promise<SerializedInstruction[]> {
  if (!TREASURY_WALLET_ADDRESS) {
    throw new Error('TREASURY_WALLET_ADDRESS not configured');
  }

  const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
  const decimals = tokenInfo?.decimals ?? 6;

  return transferManager.getTransferInstructions(
    mint,
    feeAmount,
    ownerAddress,
    TREASURY_WALLET_ADDRESS,
    decimals,
  );
}

/**
 * Create a FeeTransaction audit record.
 */
export async function createFeeRecord(params: {
  walletAddress: string;
  mint: string;
  withdrawTransactionId: string;
  withdrawAmount: string;
  profitAmount: string;
  feeAmount: string;
}): Promise<void> {
  await FeeTransactionModel.create({
    ...params,
    status: FeeTransactionStatus.PENDING,
  });
}

/**
 * Update cost basis when a transaction is confirmed on-chain.
 * Uses atomic $inc to avoid race conditions.
 */
export async function updateCostBasisOnConfirm(transactionId: string): Promise<void> {
  const tx = await TransactionModel.findById(transactionId).lean();
  if (!tx) return;

  const { walletAddress, mint, amount, action, feeAmount } = tx;

  if (action === TransactionAction.DEPOSIT) {
    await UserCostBasisModel.findOneAndUpdate(
      { walletAddress, mint },
      { $inc: { totalDeposited: amount } },
      { upsert: true },
    );
  } else if (action === TransactionAction.WITHDRAW) {
    const incFields: Record<string, string> = { totalWithdrawn: amount };
    if (feeAmount) {
      incFields.totalFeesCollected = feeAmount;
    }
    await UserCostBasisModel.findOneAndUpdate(
      { walletAddress, mint },
      { $inc: incFields },
      { upsert: true },
    );

    // Update the associated FeeTransaction status
    await FeeTransactionModel.findOneAndUpdate(
      { withdrawTransactionId: transactionId, status: FeeTransactionStatus.PENDING },
      { $set: { status: FeeTransactionStatus.CONFIRMED } },
    );
  }
}

/**
 * Mark fee transaction as failed when the withdrawal transaction fails.
 */
export async function markFeeTransactionFailed(transactionId: string): Promise<void> {
  await FeeTransactionModel.findOneAndUpdate(
    { withdrawTransactionId: transactionId, status: FeeTransactionStatus.PENDING },
    { $set: { status: FeeTransactionStatus.FAILED } },
  );
}
