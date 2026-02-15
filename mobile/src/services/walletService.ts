import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { Connection, PublicKey } from '@solana/kit';
import { SOLANA_CONFIG } from '../config/solana';

export interface WalletAccount {
  publicKey: PublicKey;
  label?: string;
}

class WalletService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(SOLANA_CONFIG.rpcEndpoint, SOLANA_CONFIG.commitment);
  }

  async connect(): Promise<WalletAccount | null> {
    try {
      const result = await transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: SOLANA_CONFIG.cluster,
          identity: {
            name: 'Cashflow',
            uri: 'https://cashflow.app',
            icon: 'favicon.ico',
          },
        });

        return {
          publicKey: new PublicKey(authResult.accounts[0].address),
          label: authResult.accounts[0].label,
          authToken: authResult.auth_token,
        };
      });

      return result;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await transact(async (wallet) => {
        await wallet.deauthorize({ auth_token: '' });
      });
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  async getBalance(publicKey: PublicKey): Promise<number> {
    try {
      const balance = await this.connection.getBalance(publicKey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      console.error('Failed to get balance:', error);
      return 0;
    }
  }
}

export default new WalletService();
