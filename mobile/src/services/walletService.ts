import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { address, Address, createSolanaRpc, getBase58Decoder, getBase64Encoder } from '@solana/kit';
import { Buffer } from 'buffer';
import { SOLANA_CONFIG } from '../config/solana';

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

  async connect(): Promise<WalletAccount | null> {
    try {
      const result = await transact(async (wallet) => {
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
    } catch (error) {
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
    return transact(async (wallet) => {
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
        console.error('[MWA] signAndSendTransactions FAILED:', err?.message || err);
        throw err;
      }
    });
  }

  async disconnect(): Promise<void> {
    try {
      await transact(async (wallet) => {
        if (this.authToken) {
          await wallet.deauthorize({ auth_token: this.authToken });
        }
      });
      this.authToken = null;
    } catch (error) {
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
    } catch (error) {
      console.error('Failed to get balance:', error);
      return 0;
    }
  }
}

export default new WalletService();
