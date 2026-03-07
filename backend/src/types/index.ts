export enum EarnTokenType {
  JUPITER = 'jupiter',
  KAMINO = 'kamino',
  DRIFT = 'drift',
}

export interface IBalance {
  amount: string;
  decimals: number;
  uiAmount: number;
  usdValue: number;
}

/** Serialized Solana instruction — common format returned to mobile clients. */
export interface SerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64-encoded
}

export type SuggestionType = 'link' | 'fund_wallet_from_seeker' | 'transfer_position';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  color: string;
  buttonTitle?: string;
  url?: string;
  // transfer_position type
  transferPosition?: {
    from: { protocol: EarnTokenType; mint: string; symbol: string; apy: number };
    to: { protocol: EarnTokenType; mint: string; symbol: string; apy: number };
  };
}

export interface SuggestionsRequest {
  vaultAddress?: string;
  walletAddress?: string;
  appVersion?: string;
  buildNumber?: string;
  androidVersion?: string;
  device?: string;
  platform?: string;
}
