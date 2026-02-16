import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { address, Address, createSolanaRpc, lamports } from '@solana/kit';
import { SOLANA_CONFIG } from '../config/solana';

export interface WalletAccount {
  publicKey: Address;
  label?: string;
}

class WalletService {
  private rpc: ReturnType<typeof createSolanaRpc>;

  constructor() {
    this.rpc = createSolanaRpc(SOLANA_CONFIG.rpcEndpoint);
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
          publicKey: address(authResult.accounts[0].address),
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
