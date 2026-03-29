// Import polyfills required for Solana libraries and Privy in React Native
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';

// Make Buffer globally available
global.Buffer = Buffer;

// Polyfill crypto.subtle for @noble/ed25519 and @solana/kit
const quickCrypto = require('react-native-quick-crypto');
if (!global.crypto) {
  global.crypto = {};
}
if (!global.crypto.subtle) {
  global.crypto.subtle = quickCrypto.subtle;
}

// Process polyfill
if (typeof global.process === 'undefined') {
  global.process = { env: {} };
}
