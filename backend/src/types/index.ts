export enum EarnTokenType {
  JUPITER = 'jupiter',
  KAMINO = 'kamino',
  DRIFT = 'drift',
}

export interface IBalance {
  amount: string;
  decimals: number;
  uiAmount: number;
}
