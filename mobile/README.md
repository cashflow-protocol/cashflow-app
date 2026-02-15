# Cashflow Mobile - Solana Yield Generation App

A React Native mobile application for Solana yield generation, built for Solana Mobile (and later iOS/Android).

## Tech Stack

- **React Native 0.84.0** - Mobile framework
- **@solana/kit** - Modern Solana client library
- **@solana-mobile/mobile-wallet-adapter-protocol** - Wallet connection for Solana Mobile
- **@coral-xyz/anchor** - Solana program framework
- **TypeScript** - Type safety

## Project Structure

```
mobile/
├── src/
│   ├── screens/       # App screens
│   ├── components/    # Reusable UI components
│   ├── hooks/         # Custom React hooks (including useWallet)
│   ├── services/      # Business logic (walletService)
│   ├── config/        # App configuration
│   ├── utils/         # Utility functions
│   └── types/         # TypeScript type definitions
├── polyfills.js       # Required polyfills for Solana
├── App.tsx            # Main app component
└── index.js           # App entry point
```

## Setup & Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **iOS Setup:**
   ```bash
   cd ios
   bundle install
   bundle exec pod install
   cd ..
   ```

3. **Run on iOS:**
   ```bash
   npm run ios
   ```

4. **Run on Android:**
   ```bash
   npm run android
   ```

## Configuration

### Solana Network

Edit \`src/config/solana.ts\` to change networks:

```typescript
export const SOLANA_CONFIG = {
  cluster: 'devnet', // 'devnet' | 'mainnet-beta' | 'testnet'
  rpcEndpoint: clusterApiUrl('devnet'),
  commitment: 'confirmed',
};
```

## Features

- **Wallet Connection** - Connect Solana wallets via Mobile Wallet Adapter
- **Balance Display** - View SOL balance in real-time
- **Devnet Support** - Test on Solana devnet

## Development

### Key Files

- \`App.tsx\` - Main app with wallet provider
- \`src/hooks/useWallet.tsx\` - Wallet context and hook
- \`src/services/walletService.ts\` - Wallet operations
- \`src/screens/HomeScreen.tsx\` - Main screen UI

### Important Notes

- **Always use @solana/kit** instead of @solana/web3.js (outdated)
- Polyfills are required for Solana libraries in React Native
- Metro bundler is configured to handle crypto/buffer dependencies

## Next Steps

- [ ] Add yield generation protocols
- [ ] Implement staking features
- [ ] Add transaction history
- [ ] Create portfolio view
- [ ] Add iOS support
- [ ] Add Android support (non-Solana Mobile)

## Learn More

- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [Solana Mobile Documentation](https://docs.solanamobile.com/)
- [Solana Documentation](https://docs.solana.com/)
