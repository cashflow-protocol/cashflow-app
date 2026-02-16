/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import NewHomeScreen from './src/screens/NewHomeScreen';

function App() {
  return (
    <SafeAreaProvider>
      <WalletProvider>
        <NewHomeScreen />
      </WalletProvider>
    </SafeAreaProvider>
  );
}

export default App;
