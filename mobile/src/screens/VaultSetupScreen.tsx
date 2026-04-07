import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import ConfettiCannon from 'react-native-confetti-cannon';
import { Platform } from 'react-native';
import { createMultisigViaBackend } from '../services/squadsService';
import { useWallet } from '../hooks/useWallet';
import { ArrowLeft } from 'lucide-react-native';
import authService from '../services/authService';
import { deleteAllKeypairs, backupCloudKeyToBlockStore } from '../services/keypairStorage';
import Toast from '../components/Toast';
import { IS_SOLANA_MOBILE } from '../config/constants';
import { logScreenView, logVaultSetupStart, logVaultSetupWalletConnected, logVaultSetupSuccess, logVaultSetupError, logVaultSetupMode } from '../services/analyticsService';
import { useTheme } from '../theme/ThemeContext';

interface VaultSetupScreenProps {
  inviteCode: string;
  pin?: string;
  onComplete: () => void;
  onBack?: () => void;
  onRecovery?: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function VaultSetupScreen({ inviteCode, pin, onComplete, onBack, onRecovery }: VaultSetupScreenProps) {
  const { colors } = useTheme();
  const { connect: connectWallet } = useWallet();
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastDescription, setToastDescription] = useState('');

  // Animations
  const emojiScale = useRef(new Animated.Value(0)).current;
  const congratsOpacity = useRef(new Animated.Value(0)).current;
  const congratsTranslateY = useRef(new Animated.Value(20)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(30)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const confettiRef = useRef<any>(null);

  useEffect(() => {
    // Staggered entrance animation
    // All animations run together with staggered delays
    Animated.spring(emojiScale, {
      toValue: 1,
      damping: 10,
      stiffness: 200,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(congratsOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(congratsTranslateY, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }, 150);

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(contentTranslateY, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(buttonOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }, 300);

    // Fire confetti after a short delay
    setTimeout(() => confettiRef.current?.start(), 300);
  }, []);

  React.useEffect(() => { logScreenView('VaultSetupScreen'); }, []);

  const handleSetup = useCallback(async () => {
    logVaultSetupStart();
    setLoading(true);
    try {
      // Code already redeemed in InviteCodeScreen -- just set for auth
      authService.setInviteCode(inviteCode);

      // Placeholder payment ID (will come from IAP later)
      const paymentId = `${Platform.OS}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      const seekerMode = IS_SOLANA_MOBILE;
      const setupMode = seekerMode ? 'seeker' : 'standard';
      logVaultSetupMode(setupMode);
      let walletAddr: string | undefined;

      if (seekerMode) {
        // Seeker: connect MWA wallet (needed for signing the tx)
        setStatusText('Connecting wallet...');
        const account = await connectWallet();
        if (!account) return;
        logVaultSetupWalletConnected();
        walletAddr = account.publicKey as string;
      }

      setStatusText('Creating vault...');
      await createMultisigViaBackend(paymentId, seekerMode, walletAddr);

      // Back up cloud key to Google Block Store (Android only, not on Seeker)
      if (pin && !IS_SOLANA_MOBILE) {
        backupCloudKeyToBlockStore(pin).catch(err => {
          console.warn('[VaultSetup] Block Store backup failed:', err);
        });
      }

      logVaultSetupSuccess();
      onComplete();
    } catch (err: any) {
      const msg = err?.message || '';
      if (!msg.includes('CancellationException')) {
        logVaultSetupError(msg);
        Alert.alert('Error', msg || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
      setStatusText('');
    }
  }, [connectWallet, inviteCode, onComplete]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.onboardingGradient}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <Toast
        visible={toastVisible}
        message={toastMessage}
        description={toastDescription}
        type="warning"
        onDismiss={() => setToastVisible(false)}
      />

      <ConfettiCannon
        ref={confettiRef}
        count={80}
        origin={{ x: SCREEN_WIDTH / 2, y: -20 }}
        autoStart={false}
        fadeOut
        explosionSpeed={400}
        fallSpeed={2500}
        colors={['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD', '#F0E68C']}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {onBack && (
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7} disabled={loading}>
            <ArrowLeft size={24} color={colors.primaryButtonText} />
          </TouchableOpacity>
        )}

        <View style={styles.content}>
          <Animated.View
            style={[
              styles.heroIcon,
              { transform: [{ scale: emojiScale }] },
            ]}
          >
            <Svg width={64} height={64} viewBox="0 0 32 32" fill="none">
              <Path d="M21 17C21.5523 17 22 16.5523 22 16C22 15.4477 21.5523 15 21 15C20.4477 15 20 15.4477 20 16C20 16.5523 20.4477 17 21 17Z" fill="#fff" />
              <Path fillRule="evenodd" clipRule="evenodd" d="M21 21C23.7614 21 26 18.7614 26 16C26 13.2386 23.7614 11 21 11C18.2386 11 16 13.2386 16 16C16 18.7614 18.2386 21 21 21ZM21 19C22.6569 19 24 17.6569 24 16C24 14.3431 22.6569 13 21 13C19.3431 13 18 14.3431 18 16C18 17.6569 19.3431 19 21 19Z" fill="#fff" />
              <Path d="M7 22C7.55228 22 8 21.5523 8 21C8 20.4477 7.55228 20 7 20C6.44772 20 6 20.4477 6 21C6 21.5523 6.44772 22 7 22Z" fill="#fff" />
              <Path d="M8 12C8 12.5523 7.55228 13 7 13C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11C7.55228 11 8 11.4477 8 12Z" fill="#fff" />
              <Path fillRule="evenodd" clipRule="evenodd" d="M2.32698 5.63803C2 6.27976 2 7.11984 2 8.8V23.2C2 24.8802 2 25.7202 2.32698 26.362C2.6146 26.9265 3.07354 27.3854 3.63803 27.673C4.27976 28 5.11984 28 6.8 28H25.2C26.8802 28 27.7202 28 28.362 27.673C28.9265 27.3854 29.3854 26.9265 29.673 26.362C30 25.7202 30 24.8802 30 23.2V8.8C30 7.11984 30 6.27976 29.673 5.63803C29.3854 5.07354 28.9265 4.6146 28.362 4.32698C27.7202 4 26.8802 4 25.2 4H6.8C5.11984 4 4.27976 4 3.63803 4.32698C3.07354 4.6146 2.6146 5.07354 2.32698 5.63803ZM25.2 6H6.8C5.92692 6 5.39239 6.00156 4.99247 6.03423C4.80617 6.04945 4.69345 6.06857 4.625 6.08469C4.59244 6.09236 4.57241 6.09879 4.56158 6.10265C4.55118 6.10636 4.54601 6.10899 4.54601 6.10899C4.35785 6.20487 4.20487 6.35785 4.10899 6.54601C4.10899 6.54601 4.10636 6.55118 4.10265 6.56158C4.09879 6.57241 4.09236 6.59244 4.08469 6.625C4.06857 6.69345 4.04945 6.80617 4.03423 6.99247C4.00156 7.39239 4 7.92692 4 8.8V23.2C4 24.0731 4.00156 24.6076 4.03423 25.0075C4.04945 25.1938 4.06857 25.3065 4.08469 25.375C4.09236 25.4076 4.09879 25.4276 4.10265 25.4384C4.10636 25.4488 4.10899 25.454 4.10899 25.454C4.20487 25.6422 4.35785 25.7951 4.54601 25.891C4.54601 25.891 4.55118 25.8936 4.56158 25.8973C4.57241 25.9012 4.59244 25.9076 4.625 25.9153C4.69345 25.9314 4.80617 25.9505 4.99247 25.9658C5.39239 25.9984 5.92692 26 6.8 26H25.2C26.0731 26 26.6076 25.9984 27.0075 25.9658C27.1938 25.9505 27.3065 25.9314 27.375 25.9153C27.4076 25.9076 27.4276 25.9012 27.4384 25.8973C27.4488 25.8936 27.454 25.891 27.454 25.891C27.6422 25.7951 27.7951 25.6422 27.891 25.454C27.891 25.454 27.8936 25.4488 27.8973 25.4384C27.9012 25.4276 27.9076 25.4076 27.9153 25.375C27.9314 25.3065 27.9505 25.1938 27.9658 25.0075C27.9984 24.6076 28 24.0731 28 23.2V8.8C28 7.92692 27.9984 7.39239 27.9658 6.99247C27.9505 6.80617 27.9314 6.69345 27.9153 6.625C27.9076 6.59244 27.9012 6.57241 27.8973 6.56158C27.8936 6.55118 27.891 6.54601 27.891 6.54601C27.7951 6.35785 27.6422 6.20487 27.454 6.10899C27.454 6.10899 27.4488 6.10636 27.4384 6.10265C27.4276 6.09879 27.4076 6.09236 27.375 6.08469C27.3065 6.06857 27.1938 6.04945 27.0075 6.03423C26.6076 6.00156 26.0731 6 25.2 6Z" fill="#fff" />
            </Svg>
          </Animated.View>

          <Animated.Text
            style={[
              styles.congrats,
              { color: colors.onboardingText },
              {
                opacity: congratsOpacity,
                transform: [{ translateY: congratsTranslateY }],
              },
            ]}
          >
            You're in!
          </Animated.Text>

          <Animated.View
            style={{
              opacity: contentOpacity,
              transform: [{ translateY: contentTranslateY }],
              alignItems: 'center',
            }}
          >
            <Text style={[styles.title, { color: colors.onboardingText }]}>Create Your Vault</Text>
            <Text style={[styles.description, { color: colors.onboardingTextMuted }]}>
              Connect your wallet and set up a secure{'\n'}multisig vault to get started.
            </Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.bottomSection, { opacity: buttonOpacity }]}>
          <TouchableOpacity
            style={[styles.setupButton, { backgroundColor: colors.onboardingButton }, loading && styles.buttonDisabled]}
            onPress={handleSetup}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#6d28d9" />
                <Text style={[styles.setupButtonText, { color: colors.onboardingButtonText }]}>{statusText}</Text>
              </View>
            ) : (
              <Text style={[styles.setupButtonText, { color: colors.onboardingButtonText }]}>Set Up Vault</Text>
            )}
          </TouchableOpacity>
          {onRecovery && (
            <TouchableOpacity
              onPress={onRecovery}
              activeOpacity={0.7}
              style={{ alignItems: 'center', marginTop: 16 }}
            >
              <Text style={{ color: colors.onboardingTextMuted, fontSize: 13 }}>Recover existing vault</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  heroIcon: {
    marginBottom: 16,
  },
  congrats: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 32,
    letterSpacing: -0.5,
  },
  iconContainer: {
    marginBottom: 24,
  },
  iconGlow: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  setupButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  setupButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
