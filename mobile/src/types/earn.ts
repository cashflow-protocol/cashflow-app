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
