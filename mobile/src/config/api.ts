import { Platform } from 'react-native';

// Use deployed API by default. Only use localhost for iOS simulator dev.
const useLocalhost = __DEV__ && Platform.OS === 'ios';

export const API_CONFIG = {
  baseUrl: useLocalhost
    ? 'http://localhost:3000'
    : 'https://api-dev.cashflow.fun',
  /** Ed25519 public key (SPKI base64) for verifying backend response signatures. */
  responseVerifyKey: 'MCowBQYDK2VwAyEArYOVpqz6hAvKqgJs2GcLO/vjJmBMD/pdMFRezS53Mcg=',
};
