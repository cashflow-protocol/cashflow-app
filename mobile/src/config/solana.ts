export type Cluster = 'mainnet-beta' | 'devnet' | 'testnet';

// Solana RPC endpoints
export const RPC_ENDPOINTS = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
} as const;

export const SOLANA_CONFIG: {
  cluster: Cluster;
  rpcEndpoint: string;
  commitment: 'confirmed';
} = {
  cluster: 'mainnet-beta',
  rpcEndpoint: RPC_ENDPOINTS['mainnet-beta'],
  commitment: 'confirmed',
};

/** Override the RPC endpoint at runtime (called after fetching config from backend). */
export function setSolanaRpcEndpoint(url: string): void {
  SOLANA_CONFIG.rpcEndpoint = url;
}

export const NETWORK_CONFIG = {
  devnet: {
    name: 'Devnet',
    endpoint: RPC_ENDPOINTS.devnet,
  },
  'mainnet-beta': {
    name: 'Mainnet Beta',
    endpoint: RPC_ENDPOINTS['mainnet-beta'],
  },
  testnet: {
    name: 'Testnet',
    endpoint: RPC_ENDPOINTS.testnet,
  },
};
