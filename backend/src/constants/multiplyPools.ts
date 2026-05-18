import { SOL_MINT, USDC_MINT } from './tokens';

export const JLP_MINT = '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4';
export const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
export const JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v';

export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const KAMINO_JLP_MARKET = 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek';

export interface MultiplyPool {
  /** Synthetic pool ID used as `vaultAddress` on EarnToken rows. */
  id: string;
  title: string;
  market: string;
  collMint: string;
  collSymbol: string;
  collDecimals: number;
  debtMint: string;
  debtSymbol: string;
  debtDecimals: number;
  /** Token the user funds the position with. Must equal collMint or debtMint. */
  defaultDepositMint: string;
  minLeverage: number;
  maxLeverage: number;
  defaultLeverage: number;
  /** Kamino eMode group; 0 / undefined = no eMode. */
  elevationGroup?: number;
  /** Default slippage for the embedded Jupiter swap. Higher for thin LP routes. */
  defaultSlippageBps: number;
  /** Minimum deposit, in raw lamports of defaultDepositMint. */
  minDepositAmount: string;
  /** Minimum withdraw, in raw lamports of defaultDepositMint. */
  minWithdrawAmount: string;
  /** App build gate so older clients don't try to deposit without the leverage UI. */
  minAppBuild?: number;
  categories: string[];
}

export const MULTIPLY_POOLS: MultiplyPool[] = [
  {
    id: 'mlt_JLP_USDC',
    title: 'JLP / USDC Multiply',
    market: KAMINO_JLP_MARKET,
    collMint: JLP_MINT,
    collSymbol: 'JLP',
    collDecimals: 6,
    debtMint: USDC_MINT,
    debtSymbol: 'USDC',
    debtDecimals: 6,
    defaultDepositMint: USDC_MINT,
    minLeverage: 1.1,
    maxLeverage: 3.0,
    defaultLeverage: 2.0,
    defaultSlippageBps: 75,
    minDepositAmount: '10000000', // $10 USDC
    minWithdrawAmount: '1000000', // $1 USDC
    categories: ['loop'],
  },
  {
    id: 'mlt_JitoSOL_SOL',
    title: 'JitoSOL / SOL Multiply',
    market: KAMINO_MAIN_MARKET,
    collMint: JITOSOL_MINT,
    collSymbol: 'JitoSOL',
    collDecimals: 9,
    debtMint: SOL_MINT,
    debtSymbol: 'SOL',
    debtDecimals: 9,
    defaultDepositMint: SOL_MINT,
    minLeverage: 1.1,
    maxLeverage: 4.0,
    defaultLeverage: 2.5,
    elevationGroup: 2,
    defaultSlippageBps: 50,
    minDepositAmount: '50000000', // 0.05 SOL
    minWithdrawAmount: '10000000', // 0.01 SOL
    categories: ['loop'],
  },
  {
    id: 'mlt_JupSOL_SOL',
    title: 'JupSOL / SOL Multiply',
    market: KAMINO_MAIN_MARKET,
    collMint: JUPSOL_MINT,
    collSymbol: 'JupSOL',
    collDecimals: 9,
    debtMint: SOL_MINT,
    debtSymbol: 'SOL',
    debtDecimals: 9,
    defaultDepositMint: SOL_MINT,
    minLeverage: 1.1,
    maxLeverage: 4.0,
    defaultLeverage: 2.5,
    elevationGroup: 2,
    defaultSlippageBps: 50,
    minDepositAmount: '50000000',
    minWithdrawAmount: '10000000',
    categories: ['loop'],
  },
];

export const MULTIPLY_POOL_BY_ID: Record<string, MultiplyPool> = Object.fromEntries(
  MULTIPLY_POOLS.map((p) => [p.id, p]),
);

/** Display info for the collateral mints, used by the toJSON transform on EarnToken
 *  when the mobile asks for a token-icon fallback for the secondary token. */
export const MULTIPLY_COLLATERAL_INFO: Record<string, { symbol: string; name: string; decimals: number; logoUrl: string }> = {
  [JLP_MINT]: { symbol: 'JLP', name: 'Jupiter Perps LP', decimals: 6, logoUrl: 'https://static.jup.ag/jlp/icon.png' },
  [JITOSOL_MINT]: { symbol: 'JitoSOL', name: 'JitoSOL', decimals: 9, logoUrl: 'https://storage.googleapis.com/token-metadata/JitoSOL-256.png' },
  [JUPSOL_MINT]: { symbol: 'JupSOL', name: 'JupSOL', decimals: 9, logoUrl: 'https://static.jup.ag/jupSOL/icon.png' },
};
