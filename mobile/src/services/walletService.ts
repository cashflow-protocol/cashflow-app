import { address, Address, createSolanaRpc, getBase58Decoder, getBase64Encoder } from '@solana/kit';
import { Buffer } from 'buffer';
import { SOLANA_CONFIG } from '../config/solana';
import { IS_SOLANA_MOBILE } from '../config/constants';
import { logError } from './analyticsService';

// Use require() instead of dynamic import() to avoid Metro lazy-bundle loading,
// which fails on physical devices (tries to fetch from localhost:8081).
// Guard behind IS_SOLANA_MOBILE to avoid crashing on iOS where the native module doesn't exist.
let _transact: typeof import('@solana-mobile/mobile-wallet-adapter-protocol').transact | null = null;
function getTransact() {
  if (!IS_SOLANA_MOBILE) {
    throw new Error('MWA is not available on this platform');
  }
  if (!_transact) {
    const mwa = require('@solana-mobile/mobile-wallet-adapter-protocol');
    _transact = mwa.transact;
  }
  return _transact!;
}

export interface WalletAccount {
  publicKey: Address;
  label?: string;
}

const IDENTITY = {
  name: 'Cashflow',
  uri: 'https://cashflow.fun',
  icon: 'favicon.ico',
};

class WalletService {
  private rpc: ReturnType<typeof createSolanaRpc>;
  private authToken: string | null = null;

  constructor() {
    this.rpc = createSolanaRpc(SOLANA_CONFIG.rpcEndpoint);
  }

  /** Recreate the RPC client with the current endpoint. Call after setSolanaRpcEndpoint(). */
  resetRpc(): void {
    this.rpc = createSolanaRpc(SOLANA_CONFIG.rpcEndpoint);
  }

  async connect(): Promise<WalletAccount | null> {
    try {
      const result = await getTransact()(async (wallet: any) => {
        const authResult = await wallet.authorize({
          cluster: SOLANA_CONFIG.cluster,
          identity: IDENTITY,
        });

        // MWA returns address as base64, convert to base58 for @solana/kit
        const base64Addr = authResult.accounts[0].address;
        const bytes = getBase64Encoder().encode(base64Addr);
        const base58Addr = getBase58Decoder().decode(bytes);

        this.authToken = authResult.auth_token;

        return {
          publicKey: address(base58Addr),
          label: authResult.accounts[0].label,
        };
      });

      return result;
    } catch (error: any) {
      logError('wallet_connect', error?.message || 'unknown');
      console.error('Failed to connect wallet:', error);
      return null;
    }
  }

  async signAndSendTransactions(transactions: Uint8Array[]): Promise<Uint8Array[]> {
    // MWA expects base64-encoded transaction strings, not raw Uint8Array
    const base64Payloads = transactions.map(tx =>
      Buffer.from(tx).toString('base64'),
    );

    console.log('[MWA] starting transact for signing...');
    return getTransact()(async (wallet: any) => {
      // Reauthorize silently if we have a token, otherwise full authorize
      if (this.authToken) {
        console.log('[MWA] reauthorizing with existing token...');
        const auth = await wallet.reauthorize({ auth_token: this.authToken, identity: IDENTITY });
        this.authToken = auth.auth_token;
      } else {
        console.log('[MWA] no token, doing full authorize...');
        const auth = await wallet.authorize({
          cluster: SOLANA_CONFIG.cluster,
          identity: IDENTITY,
        });
        this.authToken = auth.auth_token;
      }
      console.log('[MWA] authorized, signing', transactions.length, 'tx(s)...');

      try {
        const result = await wallet.signAndSendTransactions({
          payloads: base64Payloads,
        });
        console.log('[MWA] signAndSendTransactions done, sigs:', result.signatures.length);
        // Decode base64 signatures back to Uint8Array for callers
        return result.signatures.map((sig: string) =>
          new Uint8Array(Buffer.from(sig, 'base64')),
        );
      } catch (err: any) {
        logError('wallet_sign_send', err?.message || 'unknown');
        console.error('[MWA] signAndSendTransactions FAILED:', err?.message || err);
        throw err;
      }
    });
  }

  async signTransactions(transactions: Uint8Array[]): Promise<Uint8Array[]> {
    const base64Payloads = transactions.map(tx =>
      Buffer.from(tx).toString('base64'),
    );

    console.log('[MWA] starting transact for sign-only...');
    return getTransact()(async (wallet: any) => {
      if (this.authToken) {
        console.log('[MWA] reauthorizing with existing token...');
        const auth = await wallet.reauthorize({ auth_token: this.authToken, identity: IDENTITY });
        this.authToken = auth.auth_token;
      } else {
        console.log('[MWA] no token, doing full authorize...');
        const auth = await wallet.authorize({
          cluster: SOLANA_CONFIG.cluster,
          identity: IDENTITY,
        });
        this.authToken = auth.auth_token;
      }
      console.log('[MWA] authorized, signing (no send)', transactions.length, 'tx(s)...');

      try {
        const result = await wallet.signTransactions({
          payloads: base64Payloads,
        });
        if (!result?.signed_payloads?.length) {
          throw new Error('MWA returned no signed payloads');
        }
        console.log('[MWA] signTransactions done, payloads:', result.signed_payloads.length);
        return result.signed_payloads.map((payload: string) =>
          new Uint8Array(Buffer.from(payload, 'base64')),
        );
      } catch (err: any) {
        logError('wallet_sign', err?.message || 'unknown');
        console.error('[MWA] signTransactions FAILED:', err?.message || err);
        throw err;
      }
    });
  }

  /**
   * Sign one or more arbitrary messages with the connected MWA wallet.
   * Used for off-chain attestations (e.g. proving Seeker device ownership).
   */
  async signMessages(messages: Uint8Array[], signerAddress: string): Promise<Uint8Array[]> {
    const base64Payloads = messages.map((m) => Buffer.from(m).toString('base64'));

    return getTransact()(async (wallet: any) => {
      if (this.authToken) {
        const auth = await wallet.reauthorize({ auth_token: this.authToken, identity: IDENTITY });
        this.authToken = auth.auth_token;
      } else {
        const auth = await wallet.authorize({
          cluster: SOLANA_CONFIG.cluster,
          identity: IDENTITY,
        });
        this.authToken = auth.auth_token;
      }

      try {
        const result = await wallet.signMessages({
          addresses: [signerAddress],
          payloads: base64Payloads,
        });
        if (!result?.signed_payloads?.length) {
          throw new Error('MWA returned no signed payloads');
        }
        // Returned payloads are signed-message envelopes:
        //   [...signature(64 bytes), ...messageBytes]
        // We extract just the signature for verification on backend.
        return result.signed_payloads.map((payload: string) => {
          const bytes = new Uint8Array(Buffer.from(payload, 'base64'));
          return bytes.slice(0, 64);
        });
      } catch (err: any) {
        logError('wallet_sign_message', err?.message || 'unknown');
        throw err;
      }
    });
  }

  async disconnect(): Promise<void> {
    try {
      await getTransact()(async (wallet: any) => {
        if (this.authToken) {
          await wallet.deauthorize({ auth_token: this.authToken });
        }
      });
      this.authToken = null;
    } catch (error: any) {
      logError('wallet_disconnect', error?.message || 'unknown');
      console.error('Failed to disconnect wallet:', error);
    }
  }

  getRpc() {
    return this.rpc;
  }

  async getBalance(publicKey: Address): Promise<number> {
    try {
      const balanceResponse = await this.rpc.getBalance(publicKey).send();
      return Number(balanceResponse.value) / 1e9; // Convert lamports to SOL
    } catch (error: any) {
      logError('wallet_get_balance', error?.message || 'unknown');
      console.error('Failed to get balance:', error);
      return 0;
    }
  }
}

export default new WalletService();
