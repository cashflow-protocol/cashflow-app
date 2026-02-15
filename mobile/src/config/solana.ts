import { clusterApiUrl } from '@solana/kit';

export type Cluster = 'mainnet-beta' | 'devnet' | 'testnet';

export const SOLANA_CONFIG = {
  cluster: 'devnet' as Cluster,
  rpcEndpoint: clusterApiUrl('devnet'),
  commitment: 'confirmed' as const,
};

export const NETWORK_CONFIG = {
  devnet: {
    name: 'Devnet',
    endpoint: clusterApiUrl('devnet'),
  },
  'mainnet-beta': {
    name: 'Mainnet Beta',
    endpoint: clusterApiUrl('mainnet-beta'),
  },
  testnet: {
    name: 'Testnet',
    endpoint: clusterApiUrl('testnet'),
  },
};
