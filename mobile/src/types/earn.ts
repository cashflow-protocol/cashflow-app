export type EarnTokenType = 'jupiter' | 'kamino' | 'drift';

export interface EarnToken {
  type: EarnTokenType;
  mint: string;
  vaultAddress: string;
  vaultTitle: string;
  symbol: string;
  rewardsRate: number;
  status: string;
  name: string;
  decimals: number;
  logoUrl: string;
  minDepositAmount?: string;
  minWithdrawAmount?: string;
}

export interface WalletAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  amount: string;
  uiAmount: number;
  usdValue: number;
  isVerified: boolean;
}

export type SuggestionType = 'link' | 'fund_wallet_from_seeker' | 'transfer_position' | 'add_recovery';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  color: string;
  buttonTitle?: string;
  url?: string;
  transferPosition?: {
    from: { protocol: EarnTokenType; mint: string; symbol: string; apy: number };
    to: { protocol: EarnTokenType; mint: string; symbol: string; apy: number };
  };
}

export interface EarnPosition {
  type: EarnTokenType;
  mint: string;
  symbol: string;
  vaultAddress?: string;
  balance: {
    amount: string;
    decimals: number;
    uiAmount: number;
    usdValue: number;
  };
}
