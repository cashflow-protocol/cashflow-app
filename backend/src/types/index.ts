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
