/**
 * Cashflow - Solana Yield Generation Mobile App
 * @format
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StatusBar, StyleSheet, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeContext';
import { WalletProvider } from './src/hooks/useWallet';
import OnboardingScreen from './src/screens/OnboardingScreen';
import InviteCodeScreen from './src/screens/InviteCodeScreen';
import VaultSetupScreen from './src/screens/VaultSetupScreen';
import WaitlistDashboardScreen from './src/screens/WaitlistDashboardScreen';
import PinSetupScreen from './src/screens/PinSetupScreen';
import HomeScreen from './src/screens/HomeScreen';
import EarnScreen from './src/screens/EarnScreen';
import AssetsScreen from './src/screens/AssetsScreen';
import MoreScreen from './src/screens/MoreScreen';
import SquadsScreen from './src/screens/SquadsScreen';
import AddMemberScreen from './src/screens/AddMemberScreen';
import KeysRecoveryScreen from './src/screens/KeysRecoveryScreen';
import AddRecoveryKeyScreen from './src/screens/AddRecoveryKeyScreen';
import ChangePinScreen from './src/screens/ChangePinScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import VaultRecoveryScreen from './src/screens/VaultRecoveryScreen';
import BiometricLockScreen from './src/components/BiometricLockScreen';
import TabBar, { type TabName } from './src/components/TabBar';
import { getVault } from './src/services/vaultStorage';
import { checkWaitlistStatus } from './src/services/onboardingService';
import { hasPin } from './src/services/pinStorage';
import { migrateKeypairsToBiometric, getCloudPublicKey } from './src/services/keypairStorage';
import apiService from './src/services/apiService';
import { setSolanaRpcEndpoint } from './src/config/solana';
import { initializePushNotifications, initializeWaitlistPushNotifications, setupForegroundHandler } from './src/services/pushNotificationService';
import { initializeRealtimeNotifications, stopRealtimeNotifications } from './src/services/realtimeNotificationService';
import Toast from './src/components/Toast';
import { invalidateAssets } from './src/hooks/useAssets';
import { invalidateEarnTokens } from './src/hooks/useEarnTokens';
import {
  logScreenView,
  logTabPress,
  logAppInit,
  logAppLocked,
  logPushNotificationReceived,
  setUserHasVault,
  setUserOnWaitlist,
} from './src/services/analyticsService';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

type SubScreen = 'squads' | 'add-member' | 'change-pin' | 'notifications' | 'keys-recovery' | 'add-recovery-key' | null;
type OnboardingStep = 'carousel' | 'invite-code' | 'vault-setup' | 'waitlist' | 'vault-recovery' | null;

function App() {
  const [checkingVault, setCheckingVault] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [locked, setLocked] = useState(true);
  const [activeTab, setActiveTab] = useState<TabName>('home');
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('carousel');
  const [inviteCodeFrom, setInviteCodeFrom] = useState<'carousel' | 'waitlist'>('carousel');
  const [inviteCode, setInviteCode] = useState('');
  const backgroundedAt = useRef<number | null>(null);
  const recentNotifs = useRef(new Set<string>());
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastDescription, setToastDescription] = useState('');

  useEffect(() => {
    (async () => {
      const [vault, config, pinExists, cloudPk] = await Promise.all([
        getVault(),
        apiService.getConfig().catch(() => null),
        hasPin(),
        getCloudPublicKey(),
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

      // Analytics
      logAppInit(hasVault, pinExists);
      setUserHasVault(hasVault);
      setUserOnWaitlist(!hasVault && !!cloudPk);
      // If user previously joined the waitlist, check if they've been approved
      if (!hasVault && cloudPk) {
        try {
          const status = await checkWaitlistStatus(cloudPk);
          if (status.approved && status.inviteCode) {
            // Already approved — go straight to vault setup
            setInviteCode(status.inviteCode);
            setOnboardingStep('vault-setup');
          } else {
            setOnboardingStep('waitlist');
          }
        } catch {
          // If check fails, fall back to waitlist screen
          setOnboardingStep('waitlist');
        }
        // Initialize push notifications for waitlist users
        initializeWaitlistPushNotifications(cloudPk).catch((err) => {
          console.error('Waitlist push notification init failed:', err);
        });
      }
      setCheckingVault(false);

      // Migrate existing keys to biometric protection (one-time, safe to call repeatedly)
      if (hasVault) {
        migrateKeypairsToBiometric().catch((err) => {
          console.error('Migration failed:', err);
        });

        // Initialize push notifications for authenticated users
        initializePushNotifications().catch((err) => {
          console.error('Push notification init failed:', err);
        });
      }
    })();
  }, []);

  const handleIncomingNotification = useCallback((title: string, body: string, data?: Record<string, string>) => {
    // Deduplicate — same title+type within 5 seconds means duplicate delivery (FCM + RTDB)
    const dedupeKey = `${title}:${data?.type || ''}`;
    if (recentNotifs.current.has(dedupeKey)) return;
    recentNotifs.current.add(dedupeKey);
    setTimeout(() => recentNotifs.current.delete(dedupeKey), 5000);

    logPushNotificationReceived(title);
    setToastMessage(title);
    setToastDescription(body);
    setToastVisible(true);

    const type = data?.type;
    if (type === 'transfer_in' || type === 'transfer_out') {
      invalidateAssets();
    } else if (type === 'deposit' || type === 'withdraw') {
      invalidateAssets();
      invalidateEarnTokens();
    }
  }, []);

  // Set up foreground push notification handler
  useEffect(() => {
    if (checkingVault) return;
    const unsubscribe = setupForegroundHandler((title, body, data) => {
      handleIncomingNotification(title, body, data);
    });
    return unsubscribe;
  }, [checkingVault, handleIncomingNotification]);

  // Set up Firebase RTDB realtime notification listener
  useEffect(() => {
    if (!onboardingDone || locked) return;
    initializeRealtimeNotifications((title, body, data) => {
      handleIncomingNotification(title, body, data);
    });
    return () => stopRealtimeNotifications();
  }, [onboardingDone, locked, handleIncomingNotification]);

  // Lock app when returning from background after timeout
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (nextState === 'active' && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed >= LOCK_TIMEOUT_MS && onboardingDone) {
          logAppLocked();
          setLocked(true);
        }
      }
    });
    return () => subscription.remove();
  }, [onboardingDone]);

  const handleTabPress = useCallback((tab: TabName) => {
    logTabPress(tab);
    logScreenView(tab === 'home' ? 'HomeScreen' : tab === 'earn' ? 'EarnScreen' : tab === 'assets' ? 'AssetsScreen' : 'MoreScreen');
    setActiveTab(tab);
    setSubScreen(null); // Reset sub-screen when switching tabs
  }, []);

  const handleNavigate = useCallback((screen: string) => {
    if (screen === 'onboarding') {
      setOnboardingDone(false);
      setOnboardingStep('carousel');
      setInviteCode('');
      setActiveTab('home');
      setSubScreen(null);
      return;
    }
    logScreenView(screen);
    setSubScreen(screen as SubScreen);
  }, []);

  const handleBack = useCallback(() => {
    if (subScreen === 'add-member') {
      setSubScreen('squads');
    } else if (subScreen === 'add-recovery-key') {
      setSubScreen('keys-recovery');
    } else {
      setSubScreen(null);
    }
  }, [subScreen]);

  const renderScreen = () => {
    // Sub-screens accessible from any tab
    if (subScreen === 'notifications') {
      return <NotificationsScreen onBack={handleBack} />;
    }
    if (subScreen === 'keys-recovery') {
      return <KeysRecoveryScreen onNavigate={handleNavigate} onBack={handleBack} />;
    }
    if (subScreen === 'add-recovery-key') {
      return <AddRecoveryKeyScreen onNavigate={handleNavigate} onBack={handleBack} />;
    }

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
        return <HomeScreen onNavigateToTab={handleTabPress} onNavigate={handleNavigate} />;
    }
  };

  if (checkingVault) {
    return null;
  }

  if (locked) {
    return (
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <BiometricLockScreen onUnlock={() => setLocked(false)} />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  if (!onboardingDone) {
    const handleVaultComplete = () => {
      setOnboardingDone(true);
      setNeedsPinSetup(true);
      setOnboardingStep('carousel');
      setInviteCode('');
      setUserHasVault(true);
      setUserOnWaitlist(false);

      // Initialize push notifications now that the vault exists
      initializePushNotifications().catch((err) => {
        console.error('Push notification init failed:', err);
      });
    };

    let onboardingContent;
    switch (onboardingStep) {
      case 'invite-code':
        onboardingContent = (
          <InviteCodeScreen
            onValidCode={(code) => {
              setInviteCode(code);
              setOnboardingStep('vault-setup');
            }}
            onBack={() => setOnboardingStep(inviteCodeFrom)}
          />
        );
        break;
      case 'vault-setup':
        onboardingContent = (
          <VaultSetupScreen
            inviteCode={inviteCode}
            onComplete={handleVaultComplete}
            onRecovery={() => setOnboardingStep('vault-recovery')}
          />
        );
        break;
      case 'waitlist':
        onboardingContent = (
          <WaitlistDashboardScreen
            onApproved={(code) => {
              setInviteCode(code);
              setOnboardingStep('vault-setup');
            }}
            onBack={() => setOnboardingStep('carousel')}
            onHaveInviteCode={() => { setInviteCodeFrom('waitlist'); setOnboardingStep('invite-code'); }}
          />
        );
        break;
      case 'vault-recovery':
        onboardingContent = (
          <VaultRecoveryScreen
            onComplete={handleVaultComplete}
            onBack={() => setOnboardingStep('waitlist')}
          />
        );
        break;
      case 'carousel':
      default:
        onboardingContent = (
          <OnboardingScreen
            onHaveInviteCode={() => { setInviteCodeFrom('carousel'); setOnboardingStep('invite-code'); }}
            onJoinWaitlist={() => setOnboardingStep('waitlist')}
          />
        );
        break;
    }

    return (
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <WalletProvider>
            {onboardingContent}
          </WalletProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  if (needsPinSetup) {
    return (
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <PinSetupScreen onComplete={() => setNeedsPinSetup(false)} />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  if (subScreen === 'change-pin') {
    return (
      <ThemeProvider>
        <SafeAreaProvider>
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <ChangePinScreen onComplete={() => setSubScreen(null)} onBack={() => setSubScreen(null)} />
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <WalletProvider>
          <View style={styles.root}>
            {renderScreen()}
            <TabBar activeTab={activeTab} onTabPress={handleTabPress} />
            <Toast
              visible={toastVisible}
              message={toastMessage}
              description={toastDescription}
              type="success"
              onDismiss={() => setToastVisible(false)}
            />
          </View>
        </WalletProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default App;
