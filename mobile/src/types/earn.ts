export type EarnTokenType = 'jupiter' | 'kamino' | 'kamino_multiply' | 'drift' | (string & {});

export interface MultiplyConfig {
  collMint: string;
  collSymbol: string;
  collDecimals: number;
  collLogoUrl?: string;
  debtMint: string;
  debtSymbol: string;
  debtDecimals: number;
  defaultDepositMint: string;
  leverageRange: { min: number; max: number; default: number };
  apyAtDefault: number;
  liquidationLtv: number;
}

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
  categories?: string[];
  protocolName?: string;
  protocolIconUrl?: string;
  /** Present on Kamino Multiply rows — carries the collateral/debt config. */
  multiply?: MultiplyConfig;
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

export interface MultiplyPositionExtra {
  collMint: string;
  debtMint: string;
  collAmount: string;
  debtAmount: string;
  collValueUsd: number;
  debtValueUsd: number;
  netEquityUsd: number;
  currentLeverage: number;
  liquidationLtv: number;
  healthFactor: number;
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
  /** Present on Kamino Multiply positions — leveraged balance-sheet view. */
  multiply?: MultiplyPositionExtra;
}
