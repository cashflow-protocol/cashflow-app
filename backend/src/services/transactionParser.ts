import { NotificationType } from '../models';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants/tokens';

// Known program IDs for DeFi protocol detection
const PROTOCOL_PROGRAMS: Record<string, string> = {
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcPX7a': 'Jupiter',
  'KLend2g3cP87ber41GufkBAs8vUHbERnYghi1cSig9ag': 'Kamino',
  'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH': 'Drift',
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface HeliusTokenTransfer {
  mint: string;
  tokenAmount: number;
  fromUserAccount: string;
  toUserAccount: string;
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number; // in lamports
}

export interface HeliusEnhancedTransaction {
  signature: string;
  type: string;
  source: string;
  tokenTransfers: HeliusTokenTransfer[];
  nativeTransfers: HeliusNativeTransfer[];
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      mint: string;
      rawTokenAmount: { tokenAmount: string; decimals: number };
      userAccount: string;
    }>;
  }>;
  instructions: Array<{
    programId: string;
    accounts: string[];
    data: string;
  }>;
}

export interface ParsedNotification {
  title: string;
  body?: string;
  type: NotificationType;
  txSignature: string;
  metadata: {
    mint?: string;
    symbol?: string;
    amount?: string;
    protocol?: string;
    direction?: 'in' | 'out';
  };
}

function resolveSymbol(mint: string): string {
  return SUPPORTED_TOKENS_BY_MINT[mint]?.symbol || mint.slice(0, 6) + '...';
}

function formatAmount(amount: number): string {
  if (amount >= 1) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return amount.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function detectProtocol(tx: HeliusEnhancedTransaction): string | null {
  for (const ix of tx.instructions) {
    if (PROTOCOL_PROGRAMS[ix.programId]) {
      return PROTOCOL_PROGRAMS[ix.programId];
    }
  }
  return null;
}

export function parseTransaction(
  tx: HeliusEnhancedTransaction,
  vaultAddress: string,
): ParsedNotification | null {
  const protocol = detectProtocol(tx);

  // Check token transfers first
  for (const transfer of tx.tokenTransfers) {
    if (transfer.tokenAmount === 0) continue;

    const symbol = resolveSymbol(transfer.mint);
    const amount = formatAmount(transfer.tokenAmount);

    if (transfer.toUserAccount === vaultAddress) {
      // Receiving tokens
      if (protocol) {
        return {
          title: `Withdrawn ${amount} ${symbol} from ${protocol}`,
          type: NotificationType.WITHDRAW,
          txSignature: tx.signature,
          metadata: { mint: transfer.mint, symbol, amount: String(transfer.tokenAmount), protocol, direction: 'in' },
        };
      }
      return {
        title: `Received ${amount} ${symbol}`,
        type: NotificationType.TRANSFER_IN,
        txSignature: tx.signature,
        metadata: { mint: transfer.mint, symbol, amount: String(transfer.tokenAmount), direction: 'in' },
      };
    }

    if (transfer.fromUserAccount === vaultAddress) {
      // Sending tokens
      if (protocol) {
        return {
          title: `Deposited ${amount} ${symbol} into ${protocol}`,
          type: NotificationType.DEPOSIT,
          txSignature: tx.signature,
          metadata: { mint: transfer.mint, symbol, amount: String(transfer.tokenAmount), protocol, direction: 'out' },
        };
      }
      return {
        title: `Sent ${amount} ${symbol}`,
        type: NotificationType.TRANSFER_OUT,
        txSignature: tx.signature,
        metadata: { mint: transfer.mint, symbol, amount: String(transfer.tokenAmount), direction: 'out' },
      };
    }
  }

  // Check native SOL transfers
  for (const transfer of tx.nativeTransfers) {
    // Ignore tiny amounts (rent, fees) — threshold: 0.001 SOL (1_000_000 lamports)
    if (transfer.amount < 1_000_000) continue;

    const solAmount = transfer.amount / 1_000_000_000;
    const amount = formatAmount(solAmount);

    if (transfer.toUserAccount === vaultAddress) {
      if (protocol) {
        return {
          title: `Withdrawn ${amount} SOL from ${protocol}`,
          type: NotificationType.WITHDRAW,
          txSignature: tx.signature,
          metadata: { mint: SOL_MINT, symbol: 'SOL', amount: String(solAmount), protocol, direction: 'in' },
        };
      }
      return {
        title: `Received ${amount} SOL`,
        type: NotificationType.TRANSFER_IN,
        txSignature: tx.signature,
        metadata: { mint: SOL_MINT, symbol: 'SOL', amount: String(solAmount), direction: 'in' },
      };
    }

    if (transfer.fromUserAccount === vaultAddress) {
      if (protocol) {
        return {
          title: `Deposited ${amount} SOL into ${protocol}`,
          type: NotificationType.DEPOSIT,
          txSignature: tx.signature,
          metadata: { mint: SOL_MINT, symbol: 'SOL', amount: String(solAmount), protocol, direction: 'out' },
        };
      }
      return {
        title: `Sent ${amount} SOL`,
        type: NotificationType.TRANSFER_OUT,
        txSignature: tx.signature,
        metadata: { mint: SOL_MINT, symbol: 'SOL', amount: String(solAmount), direction: 'out' },
      };
    }
  }

  return null;
}
