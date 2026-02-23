/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import NewHomeScreen from './src/screens/NewHomeScreen';
import EarnScreen from './src/screens/EarnScreen';
import AssetsScreen from './src/screens/AssetsScreen';
import MoreScreen from './src/screens/MoreScreen';
import SquadsScreen from './src/screens/SquadsScreen';
import AddMemberScreen from './src/screens/AddMemberScreen';
import TabBar, { type TabName } from './src/components/TabBar';

type SubScreen = 'squads' | 'add-member' | null;

function App() {
  const [activeTab, setActiveTab] = useState<TabName>('home');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);

  const handleTabPress = useCallback((tab: TabName) => {
    setActiveTab(tab);
    setSubScreen(null); // Reset sub-screen when switching tabs
  }, []);

  const handleNavigate = useCallback((screen: string) => {
    setSubScreen(screen as SubScreen);
  }, []);

  const handleBack = useCallback(() => {
    if (subScreen === 'add-member') {
      setSubScreen('squads');
    } else {
      setSubScreen(null);
    }
  }, [subScreen]);

  const renderScreen = () => {
    // Handle sub-screens under the More tab
    if (activeTab === 'more' && subScreen) {
      switch (subScreen) {
        case 'squads':
          return <SquadsScreen onNavigate={handleNavigate} onBack={handleBack} />;
        case 'add-member':
          return <AddMemberScreen onNavigate={handleNavigate} onBack={handleBack} />;
      }
    }

    switch (activeTab) {
      case 'earn':
        return <EarnScreen />;
      case 'assets':
        return <AssetsScreen />;
      case 'more':
        return <MoreScreen onNavigate={handleNavigate} />;
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
          <TabBar activeTab={activeTab} onTabPress={handleTabPress} />
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
