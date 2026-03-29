const useDevServer = __DEV__;

export const API_CONFIG = {
  baseUrl: `https://${useDevServer ? 'api-dev' : 'api'}.cashflow.fun`,
  websiteUrl: `https://${useDevServer ? 'dev.' : ''}cashflow.fun`,
  /** Ed25519 public key (SPKI base64) for verifying backend response signatures. */
  responseVerifyKey: 'MCowBQYDK2VwAyEArYOVpqz6hAvKqgJs2GcLO/vjJmBMD/pdMFRezS53Mcg=',
};

export const PRIVY_CONFIG = {
  appId: 'cmmz2xt0y00170ci6dxwc9cst',
  clientId: 'client-WY6WxJKfDhMRyN7K4w4zvFrqBNJvuqpwGA6o2b71Ze6Qp', // TODO: Set your Privy Client ID from the Privy Dashboard
};
