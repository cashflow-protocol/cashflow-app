/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StatusBar, StyleSheet, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletProvider } from './src/hooks/useWallet';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PinSetupScreen from './src/screens/PinSetupScreen';
import HomeScreen from './src/screens/HomeScreen';
import EarnScreen from './src/screens/EarnScreen';
import AssetsScreen from './src/screens/AssetsScreen';
import MoreScreen from './src/screens/MoreScreen';
import SquadsScreen from './src/screens/SquadsScreen';
import AddMemberScreen from './src/screens/AddMemberScreen';
import ChangePinScreen from './src/screens/ChangePinScreen';
import BiometricLockScreen from './src/components/BiometricLockScreen';
import TabBar, { type TabName } from './src/components/TabBar';
import { getVault } from './src/services/vaultStorage';
import { hasPin } from './src/services/pinStorage';
import { migrateKeypairsToBiometric } from './src/services/keypairStorage';
import apiService from './src/services/apiService';
import { setSolanaRpcEndpoint } from './src/config/solana';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type SubScreen = 'squads' | 'add-member' | 'change-pin' | null;

function App() {
  const [checkingVault, setCheckingVault] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [locked, setLocked] = useState(true);
  const [activeTab, setActiveTab] = useState<TabName>('home');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const [vault, config, pinExists] = await Promise.all([
        getVault(),
        apiService.getConfig().catch(() => null),
        hasPin(),
      ]);
      if (config?.solanaRpcUrl) {
        setSolanaRpcEndpoint(config.solanaRpcUrl);
      }
      const hasVault = vault !== null;
      setOnboardingDone(hasVault);
      // Existing user with no PIN → prompt to create one
      setNeedsPinSetup(hasVault && !pinExists);
      // Only require lock if user has completed onboarding and has a PIN
      setLocked(hasVault && pinExists);
      setCheckingVault(false);

      // Migrate existing keys to biometric protection (one-time, safe to call repeatedly)
      if (hasVault) {
        migrateKeypairsToBiometric().catch((err) => {
          console.error('Migration failed:', err);
        });
      }
    })();
  }, []);

  // Lock app when returning from background after timeout
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (nextState === 'active' && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed >= LOCK_TIMEOUT_MS && onboardingDone) {
          setLocked(true);
        }
      }
    });
    return () => subscription.remove();
  }, [onboardingDone]);

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
        case 'change-pin':
          // Handled as full-screen overlay below
          break;
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

  if (locked) {
    return (
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" />
        <BiometricLockScreen onUnlock={() => setLocked(false)} />
      </SafeAreaProvider>
    );
  }

  if (!onboardingDone) {
    return (
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" />
        <WalletProvider>
          <OnboardingScreen onComplete={() => {
            setOnboardingDone(true);
            setNeedsPinSetup(true);
          }} />
        </WalletProvider>
      </SafeAreaProvider>
    );
  }

  if (needsPinSetup) {
    return (
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" />
        <PinSetupScreen onComplete={() => setNeedsPinSetup(false)} />
      </SafeAreaProvider>
    );
  }

  if (subScreen === 'change-pin') {
    return (
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" />
        <ChangePinScreen onComplete={() => setSubScreen(null)} onBack={() => setSubScreen(null)} />
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
