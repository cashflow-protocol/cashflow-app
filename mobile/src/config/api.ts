const useDevServer = __DEV__;

export const API_CONFIG = {
  baseUrl: `https://${useDevServer ? 'api-dev' : 'api'}.cashflow.fun`,
  websiteUrl: `https://${useDevServer ? 'dev.' : ''}cashflow.fun`,
  /** Ed25519 public key (SPKI base64) for verifying backend response signatures. */
  responseVerifyKey: 'MCowBQYDK2VwAyEArYOVpqz6hAvKqgJs2GcLO/vjJmBMD/pdMFRezS53Mcg=',
};
