export type RewardVerifierType =
  | 'onchain_deposit'
  | 'onchain_swap_volume'
  | 'onchain_transfer_out'
  | 'device_seeker'
  | 'social_twitter_follow'
  | 'social_twitter_retweet'
  | 'manual';

export type RewardProgressStatus = 'in_progress' | 'claimable' | 'mint_pending' | 'minted';

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
  /** USD-based: integer cents. Count-based: integer count. Boolean: '0' or '1'. */
  currentValue: string;
  targetValue: string;
  completedAt?: string;
  assetAddress?: string;
}
