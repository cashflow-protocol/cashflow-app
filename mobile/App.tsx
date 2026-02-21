/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import NewHomeScreen from './src/screens/NewHomeScreen';
import EarnScreen from './src/screens/EarnScreen';
import TabBar, { type TabName } from './src/components/TabBar';

function App() {
  const [activeTab, setActiveTab] = useState<TabName>('home');

  const renderScreen = () => {
    switch (activeTab) {
      case 'earn':
        return <EarnScreen />;
      case 'home':
      default:
        return <NewHomeScreen />;
    }
  };

  return (
    <SafeAreaProvider>
      <WalletProvider>
        <View style={styles.root}>
          {renderScreen()}
          <TabBar activeTab={activeTab} onTabPress={setActiveTab} />
        </View>
      </WalletProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default App;
