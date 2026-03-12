/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React, { useState, useCallback, useEffect } from 'react';
import { View, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import EarnScreen from './src/screens/EarnScreen';
import AssetsScreen from './src/screens/AssetsScreen';
import MoreScreen from './src/screens/MoreScreen';
import SquadsScreen from './src/screens/SquadsScreen';
import AddMemberScreen from './src/screens/AddMemberScreen';
import TabBar, { type TabName } from './src/components/TabBar';
import { getVault } from './src/services/vaultStorage';
import apiService from './src/services/apiService';
import { setSolanaRpcEndpoint } from './src/config/solana';

type SubScreen = 'squads' | 'add-member' | null;

function App() {
  const [checkingVault, setCheckingVault] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [activeTab, setActiveTab] = useState<TabName>('home');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);

  useEffect(() => {
    (async () => {
      const [vault, config] = await Promise.all([
        getVault(),
        apiService.getConfig().catch(() => null),
      ]);
      if (config?.solanaRpcUrl) {
        setSolanaRpcEndpoint(config.solanaRpcUrl);
      }
      setOnboardingDone(vault !== null);
      setCheckingVault(false);
    })();
  }, []);

  const handleTabPress = useCallback((tab: TabName) => {
    setActiveTab(tab);
    setSubScreen(null); // Reset sub-screen when switching tabs
  }, []);

  const handleNavigate = useCallback((screen: string) => {
    if (screen === 'onboarding') {
      setOnboardingDone(false);
      setActiveTab('home');
      setSubScreen(null);
      return;
    }
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
        return <HomeScreen onNavigateToTab={handleTabPress} />;
    }
  };

  if (checkingVault) {
    return null;
  }

  if (!onboardingDone) {
    return (
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" />
        <WalletProvider>
          <OnboardingScreen onComplete={() => setOnboardingDone(true)} />
        </WalletProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar translucent backgroundColor="transparent" />
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
