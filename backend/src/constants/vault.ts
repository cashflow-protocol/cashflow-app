/** Vault creation fee in lamports (0.0005 SOL) */
export const VAULT_CREATION_FEE = 500_000;

/** Target balance for admin tx fee payer after gas cover (0.05 SOL) */
export const ADMIN_COVER_TARGET = 50_000_000;

/** Jito tip amount in lamports (0.0005 SOL) */
export const JITO_TIP_LAMPORTS = 500_000;

/** Jito tip accounts — pick one at random per bundle */
export const JITO_TIP_ACCOUNTS = [
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY', 
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/** Deterministic seed for gas cover spending limit PDA */
export const GAS_COVER_SPENDING_LIMIT_SEED = 'cashflow-gas-cover';

/** Additional vote-only co-signer wallets added to every newly created squad vault */
export const EXTRA_VOTE_ONLY_MEMBERS = [
  'GyBg4isA9bVVPR55HEpZxXGoBUDmxPi9YZFTzDap1GGu',
  'DPJRJkwWrFxoMcjMFbfon1v2S8wwPY4S86PaFCmTBig4',
];
