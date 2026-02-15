// Import polyfills required for Solana libraries in React Native
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';

// Make Buffer globally available
global.Buffer = Buffer;

// TextEncoder/TextDecoder polyfill
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('text-encoding');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Process polyfill
if (typeof global.process === 'undefined') {
  global.process = { env: {} };
}
