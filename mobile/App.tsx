/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import HomeScreen from './src/screens/HomeScreen';

function App() {
  return (
    <SafeAreaProvider>
      <WalletProvider>
        <HomeScreen />
      </WalletProvider>
    </SafeAreaProvider>
  );
}

export default App;
