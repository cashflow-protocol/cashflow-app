import { TransactionAction, TransactionStatus } from '../models/Transaction';
import { TransactionModel } from '../models';
import { UserModel } from '../models/User';
import {
  RewardTask,
  RewardTaskModel,
  RewardVerifierType,
} from '../models/RewardTask';
import {
  UserRewardProgress,
  UserRewardProgressModel,
  RewardProgressStatus,
} from '../models/UserRewardProgress';
import { MintedBadgeModel } from '../models/MintedBadge';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants/tokens';
import { PriceManager } from './PriceManager';

const priceManager = new PriceManager();

export interface VerifierResult {
  /** Progress value as string. For USD-based tasks: cents. For count-based: integer. For boolean: '0' or '1'. */
  currentValue: string;
  /** Target value in same unit as currentValue. */
  targetValue: string;
  /** Whether the user has met the requirement. */
  satisfied: boolean;
}

type Verifier = (
  task: RewardTask,
  vaultAddress: string,
  progress: UserRewardProgress | null,
) => Promise<VerifierResult>;

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function rawAmountToUiAmount(rawAmount: string, decimals: number): number {
  // Use BigInt math to avoid precision loss for large amounts, then convert.
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}

function usdToCentsString(usd: number): string {
  return String(Math.floor(usd * 100));
}

async function sumTransactionsUsd(
  vaultAddress: string,
  filter: { type?: string; action: TransactionAction; mint?: string },
): Promise<number> {
  const query: Record<string, any> = {
    userVaultAddress: vaultAddress,
    action: filter.action,
    status: TransactionStatus.CONFIRMED,
  };
  if (filter.type) query.type = filter.type;
  if (filter.mint) query.mint = filter.mint;

  const txs = await TransactionModel.find(query).lean();
  let totalUsd = 0;
  for (const tx of txs) {
    const tokenInfo = SUPPORTED_TOKENS_BY_MINT[tx.mint];
    if (!tokenInfo) continue;
    const uiAmount = rawAmountToUiAmount(tx.amount, tokenInfo.decimals);
    totalUsd += priceManager.getUsdValue(tokenInfo.symbol, uiAmount);
  }
  return totalUsd;
}

/**
 * verifierConfig: { protocol: 'jupiter' | 'kamino' | 'drift' | ..., mint?: string, minUsd: number }
 */
const verifyOnchainDeposit: Verifier = async (task, vaultAddress) => {
  const cfg = task.verifierConfig ?? {};
  const totalUsd = await sumTransactionsUsd(vaultAddress, {
    type: cfg.protocol,
    action: TransactionAction.DEPOSIT,
    mint: cfg.mint,
  });
  const minUsd = Number(cfg.minUsd ?? 0);
  return {
    currentValue: usdToCentsString(totalUsd),
    targetValue: usdToCentsString(minUsd),
    satisfied: totalUsd >= minUsd,
  };
};

/**
 * verifierConfig: { minUsd: number }
 */
const verifyOnchainSwapVolume: Verifier = async (task, vaultAddress) => {
  const cfg = task.verifierConfig ?? {};
  const totalUsd = await sumTransactionsUsd(vaultAddress, {
    action: TransactionAction.SWAP,
  });
  const minUsd = Number(cfg.minUsd ?? 0);
  return {
    currentValue: usdToCentsString(totalUsd),
    targetValue: usdToCentsString(minUsd),
    satisfied: totalUsd >= minUsd,
  };
};

/**
 * verifierConfig: { mint?: string, minCount?: number, minUsd?: number }
 */
const verifyOnchainTransferOut: Verifier = async (task, vaultAddress) => {
  const cfg = task.verifierConfig ?? {};
  const query: Record<string, any> = {
    userVaultAddress: vaultAddress,
    action: TransactionAction.TRANSFER,
    status: TransactionStatus.CONFIRMED,
  };
  if (cfg.mint) query.mint = cfg.mint;

  if (cfg.minCount != null) {
    const count = await TransactionModel.countDocuments(query);
    return {
      currentValue: String(count),
      targetValue: String(cfg.minCount),
      satisfied: count >= cfg.minCount,
    };
  }

  // Default to USD-based
  const totalUsd = await sumTransactionsUsd(vaultAddress, {
    action: TransactionAction.TRANSFER,
    mint: cfg.mint,
  });
  const minUsd = Number(cfg.minUsd ?? 0);
  return {
    currentValue: usdToCentsString(totalUsd),
    targetValue: usdToCentsString(minUsd),
    satisfied: totalUsd >= minUsd,
  };
};

/**
 * verifierConfig: {} — checks user.seekerAttestedAt
 */
const verifyDeviceSeeker: Verifier = async (_task, vaultAddress) => {
  const user = await UserModel.findOne({ vaultAddress }).lean();
  const attested = !!user?.seekerAttestedAt;
  return {
    currentValue: attested ? '1' : '0',
    targetValue: '1',
    satisfied: attested,
  };
};

/**
 * verifierConfig: {} — admin sets progress.attestations.manualApprovedAt
 */
const verifyManual: Verifier = async (_task, _vaultAddress, progress) => {
  const approved = !!progress?.attestations?.manualApprovedAt;
  return {
    currentValue: approved ? '1' : '0',
    targetValue: '1',
    satisfied: approved,
  };
};

const VERIFIERS: Record<RewardVerifierType, Verifier> = {
  [RewardVerifierType.ONCHAIN_DEPOSIT]: verifyOnchainDeposit,
  [RewardVerifierType.ONCHAIN_SWAP_VOLUME]: verifyOnchainSwapVolume,
  [RewardVerifierType.ONCHAIN_TRANSFER_OUT]: verifyOnchainTransferOut,
  [RewardVerifierType.DEVICE_SEEKER]: verifyDeviceSeeker,
  [RewardVerifierType.MANUAL]: verifyManual,
  // v2: SOCIAL_TWITTER_FOLLOW, SOCIAL_TWITTER_RETWEET
  [RewardVerifierType.SOCIAL_TWITTER_FOLLOW]: verifyManual,
  [RewardVerifierType.SOCIAL_TWITTER_RETWEET]: verifyManual,
};

const REEVAL_TTL_MS = 60_000;

export interface TaskWithProgress {
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  active: boolean;
  sortOrder: number;
  mintFeeLamports: string;
  maxSupply?: number;
  mintedCount: number;
  verifierType: RewardVerifierType;
  status: RewardProgressStatus;
  currentValue: string;
  targetValue: string;
  completedAt?: Date;
  /** Asset address if minted */
  assetAddress?: string;
}

export class RewardManager {
  /**
   * Recompute all active task progress for a single vault. Returns task + progress
   * pairs ready for the API response. Runs verifiers in parallel.
   */
  async getTasksForVault(vaultAddress: string): Promise<TaskWithProgress[]> {
    const tasks = await RewardTaskModel.find({ active: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    if (tasks.length === 0) return [];

    const progressDocs = await UserRewardProgressModel.find({
      vaultAddress,
      taskSlug: { $in: tasks.map((t) => t.slug) },
    });
    const progressBySlug = new Map(progressDocs.map((p) => [p.taskSlug, p]));

    const mintedBadges = await MintedBadgeModel.find({
      vaultAddress,
      taskSlug: { $in: tasks.map((t) => t.slug) },
    }).lean();
    const badgeBySlug = new Map(mintedBadges.map((b) => [b.taskSlug, b]));

    const results = await Promise.all(
      tasks.map(async (taskDoc) => {
        const task = taskDoc as unknown as RewardTask;
        const existing = progressBySlug.get(task.slug);
        const progress = await this.evaluateTask(task, vaultAddress, existing ?? null);
        const badge = badgeBySlug.get(task.slug);
        return {
          slug: task.slug,
          title: task.title,
          description: task.description,
          imageUrl: task.imageUrl,
          active: task.active,
          sortOrder: task.sortOrder,
          mintFeeLamports: task.mintFeeLamports,
          maxSupply: task.maxSupply,
          mintedCount: task.mintedCount,
          verifierType: task.verifierType,
          status: progress.status,
          currentValue: progress.currentValue,
          targetValue: progress.targetValue,
          completedAt: progress.completedAt,
          assetAddress: badge?.assetAddress,
        } satisfies TaskWithProgress;
      }),
    );

    return results;
  }

  /**
   * Evaluate a single task for a vault, upserting UserRewardProgress.
   * Will not regress from MINT_PENDING or MINTED states.
   * Returns the latest progress shape.
   */
  async evaluateTask(
    task: RewardTask,
    vaultAddress: string,
    existing: UserRewardProgress | null,
  ): Promise<{
    status: RewardProgressStatus;
    currentValue: string;
    targetValue: string;
    completedAt?: Date;
  }> {
    // Terminal states: never re-evaluate or regress.
    if (existing?.status === RewardProgressStatus.MINTED || existing?.status === RewardProgressStatus.MINT_PENDING) {
      return {
        status: existing.status,
        currentValue: existing.currentValue,
        targetValue: existing.targetValue,
        completedAt: existing.completedAt,
      };
    }

    // Cache: skip re-evaluation if recent.
    if (existing?.lastEvaluatedAt && Date.now() - existing.lastEvaluatedAt.getTime() < REEVAL_TTL_MS) {
      return {
        status: existing.status,
        currentValue: existing.currentValue,
        targetValue: existing.targetValue,
        completedAt: existing.completedAt,
      };
    }

    const verifier = VERIFIERS[task.verifierType];
    if (!verifier) {
      throw new Error(`No verifier registered for type: ${task.verifierType}`);
    }

    const result = await verifier(task, vaultAddress, existing);
    const newStatus = result.satisfied ? RewardProgressStatus.CLAIMABLE : RewardProgressStatus.IN_PROGRESS;
    const completedAt = result.satisfied ? (existing?.completedAt ?? new Date()) : undefined;

    await UserRewardProgressModel.findOneAndUpdate(
      { vaultAddress, taskSlug: task.slug },
      {
        $set: {
          status: newStatus,
          currentValue: result.currentValue,
          targetValue: result.targetValue,
          lastEvaluatedAt: new Date(),
          ...(completedAt ? { completedAt } : {}),
        },
        $setOnInsert: {
          vaultAddress,
          taskSlug: task.slug,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    // No auto-mint: when the verifier flips to satisfied we leave progress at
    // CLAIMABLE and require the user to click Mint in the UI. The user pays
    // gas; admin reimburses signing via the inner-instruction transfer.

    return {
      status: newStatus,
      currentValue: result.currentValue,
      targetValue: result.targetValue,
      completedAt,
    };
  }

  /**
   * Re-run a single verifier for a (vault, taskSlug) pair. Used as defense-in-depth
   * before allowing a mint. Bypasses TTL cache.
   */
  async forceEvaluate(vaultAddress: string, taskSlug: string): Promise<{
    status: RewardProgressStatus;
    currentValue: string;
    targetValue: string;
  }> {
    const task = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
    if (!task) throw new Error(`Task not found: ${taskSlug}`);
    if (!task.active) throw new Error(`Task is not active: ${taskSlug}`);

    const existing = await UserRewardProgressModel.findOne({ vaultAddress, taskSlug });
    // Reset cache by setting lastEvaluatedAt to undefined locally
    if (existing) (existing as any).lastEvaluatedAt = undefined;
    return this.evaluateTask(task as unknown as RewardTask, vaultAddress, existing);
  }
}

export const rewardManager = new RewardManager();
