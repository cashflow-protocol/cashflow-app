import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { createMultisig } from '../services/squadsService';
import { useWallet } from '../hooks/useWallet';
import walletService from '../services/walletService';
import Toast from '../components/Toast';
import { MIN_LAMPORTS_FOR_VAULT } from '../config/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');


interface OnboardingScreenProps {
  onComplete: () => void;
}

// --- Inline SVG Icons ---

function YieldIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M29.6875 7.17337C29.9331 7.66806 29.7312 8.26816 29.2365 8.51373C28.7418 8.75931 28.1417 8.55737 27.8961 8.06269L27.2623 6.78598L20.6338 20.8227C19.7703 22.6514 17.2059 22.7514 16.2026 20.9956L11.2166 12.2701C11.0065 11.9024 10.463 11.9461 10.3143 12.3426L3.93611 29.3512C3.74219 29.8683 3.16578 30.1303 2.64866 29.9364C2.13154 29.7425 1.86953 29.1661 2.06345 28.6489L8.44167 11.6403C9.18515 9.65775 11.9026 9.43936 12.9531 11.2778L17.9391 20.0033C18.1398 20.3545 18.6526 20.3345 18.8253 19.9687L25.5303 5.76992L23.6752 6.69087C23.1805 6.93645 22.5804 6.73451 22.3349 6.23983C22.0893 5.74515 22.2912 5.14505 22.7859 4.89947L26.5216 3.04495C27.0163 2.79937 27.6164 3.00131 27.8619 3.49599L29.6875 7.17337Z"
        fill="#fff"
      />
    </Svg>
  );
}

function KeyIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.9291 28.9449C17.5406 28.5507 17.544 27.9177 17.9367 27.5311L18.8016 26.6794L17.9011 25.7278L15.0217 28.4791C14.6233 28.8598 13.9901 28.8443 13.6075 28.4444C13.2249 28.0445 13.2377 27.4116 13.6362 27.0309L16.5234 24.272L10.0655 17.448C9.25862 17.9515 8.29973 18.2313 7.27781 18.2031C4.51105 18.1268 2.32997 15.8221 2.40624 13.0553C2.4825 10.2886 4.78723 8.10749 7.55399 8.18376C10.3207 8.26002 12.5018 10.5647 12.4256 13.3315C12.3974 14.3534 12.0652 15.2954 11.5181 16.0732L21.8713 27.0133C22.2509 27.4145 22.2334 28.0474 21.8323 28.427C21.4312 28.8066 20.7982 28.7892 20.4186 28.3881L20.1795 28.1354L19.3436 28.9585C18.951 29.3452 18.3177 29.3391 17.9291 28.9449ZM7.33292 16.2038C5.67031 16.158 4.35965 14.7731 4.40548 13.1104C4.45131 11.4478 5.83627 10.1372 7.49888 10.183C9.16149 10.2288 10.4722 11.6138 10.4263 13.2764C10.3805 14.939 8.99553 16.2497 7.33292 16.2038Z"
        fill="#fff"
      />
      <Path
        d="M11.9564 8.02482C12.036 6.20078 10.6797 4.7213 9.00428 4.64816C7.91188 4.60048 7.25778 5.07305 6.84453 5.56637C6.62945 5.82311 6.48068 6.08745 6.38622 6.28874C6.33957 6.38816 6.3078 6.46867 6.28892 6.52025C6.27952 6.54593 6.27343 6.5641 6.27039 6.57346L6.26828 6.58008C6.11206 7.10646 5.56 7.40887 5.03172 7.25602C4.5012 7.10253 4.19555 6.54802 4.34905 6.01749L5.30965 6.29542C4.34905 6.01749 4.34933 6.01653 4.34933 6.01653L4.34963 6.0155L4.35029 6.01325L4.35185 6.00797L4.35598 5.99431C4.35918 5.98387 4.3633 5.97074 4.36838 5.95512C4.37853 5.92391 4.39255 5.88259 4.41083 5.83266C4.44732 5.73301 4.5012 5.59778 4.57567 5.43909C4.72345 5.12417 4.95883 4.70291 5.31138 4.28206C6.03337 3.42018 7.24838 2.56961 9.0915 2.65007C11.7277 2.76515 13.7607 4.90068 13.9459 7.48874L27.8822 11.9203C28.4085 12.0877 28.6995 12.65 28.5322 13.1764C28.3648 13.7027 27.8025 13.9937 27.2762 13.8263L26.9449 13.7209L26.6116 14.8458C26.4551 15.3742 25.8979 15.6754 25.3671 15.5184C24.8364 15.3614 24.5331 14.8059 24.6896 14.2775L25.0345 13.1135L23.7861 12.7165L22.5975 16.5178C22.433 17.0438 21.8714 17.3366 21.343 17.1718C20.8147 17.0069 20.5197 16.4469 20.6842 15.9209L21.8761 12.1091L12.8029 9.22398C12.5518 9.14413 12.3543 8.97436 12.2345 8.76149C12.0516 8.57121 11.9439 8.30931 11.9564 8.02482Z"
        fill="#fff"
      />
    </Svg>
  );
}

function SecurityIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M20.7893 13.6139C21.1284 13.178 21.0498 12.5497 20.6139 12.2106C20.1779 11.8716 19.5497 11.9501 19.2106 12.386L15.2359 17.4964L12.7035 14.9893C12.311 14.6008 11.6779 14.604 11.2893 14.9964C10.9007 15.3889 10.9039 16.0221 11.2964 16.4106L14.6297 19.7106C14.833 19.9118 15.1126 20.0164 15.3979 19.9979C15.6833 19.9794 15.9471 19.8396 16.1226 19.6139L20.7893 13.6139Z"
        fill="#fff"
      />
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.4855 2.51717C16.5318 2.13571 15.468 2.13571 14.5143 2.51718L6.78572 5.60863C5.72622 6.03244 4.98504 7.02752 4.92694 8.19213C4.86703 9.39302 4.80062 11.3155 4.8529 13.3062C4.90459 15.2743 5.07354 17.3974 5.51728 18.9569C6.21927 21.4239 7.95172 23.6306 9.70252 25.3626C11.4685 27.1096 13.3426 28.4604 14.4573 29.204C15.3948 29.8294 16.605 29.8294 17.5425 29.204C18.6572 28.4604 20.5312 27.1096 22.2972 25.3626C24.0481 23.6306 25.7805 21.4239 26.4825 18.9569C26.9262 17.3974 27.0952 15.2743 27.1469 13.3063C27.1992 11.3155 27.1328 9.39305 27.0729 8.19215C27.0148 7.02753 26.2736 6.03243 25.2141 5.60863L17.4855 2.51717ZM15.2571 4.37413C15.7339 4.1834 16.2658 4.1834 16.7427 4.37413L24.4713 7.46558C24.8284 7.60843 25.0574 7.93255 25.0754 8.29179C25.1339 9.4661 25.198 11.3332 25.1476 13.2537C25.0965 15.197 24.9295 17.1068 24.5589 18.4095C23.9958 20.3884 22.5473 22.3019 20.8907 23.9407C19.2493 25.5645 17.4893 26.8353 16.4326 27.5402C16.1671 27.7173 15.8326 27.7173 15.5672 27.5402C14.5105 26.8353 12.7505 25.5645 11.1091 23.9407C9.45243 22.3019 8.00402 20.3884 7.44091 18.4095C7.07024 17.1068 6.90325 15.197 6.85221 13.2537C6.80177 11.3332 6.86587 9.46609 6.92446 8.29179C6.94238 7.93255 7.17139 7.60843 7.52851 7.46558L15.2571 4.37413Z"
        fill="#fff"
      />
    </Svg>
  );
}

function VaultIcon({ size = 80 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M21 17C21.5523 17 22 16.5523 22 16C22 15.4477 21.5523 15 21 15C20.4477 15 20 15.4477 20 16C20 16.5523 20.4477 17 21 17Z"
        fill="#fff"
      />
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21 21C23.7614 21 26 18.7614 26 16C26 13.2386 23.7614 11 21 11C18.2386 11 16 13.2386 16 16C16 18.7614 18.2386 21 21 21ZM21 19C22.6569 19 24 17.6569 24 16C24 14.3431 22.6569 13 21 13C19.3431 13 18 14.3431 18 16C18 17.6569 19.3431 19 21 19Z"
        fill="#fff"
      />
      <Path
        d="M7 22C7.55228 22 8 21.5523 8 21C8 20.4477 7.55228 20 7 20C6.44772 20 6 20.4477 6 21C6 21.5523 6.44772 22 7 22Z"
        fill="#fff"
      />
      <Path
        d="M8 12C8 12.5523 7.55228 13 7 13C6.44772 13 6 12.5523 6 12C6 11.4477 6.44772 11 7 11C7.55228 11 8 11.4477 8 12Z"
        fill="#fff"
      />
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.32698 5.63803C2 6.27976 2 7.11984 2 8.8V23.2C2 24.8802 2 25.7202 2.32698 26.362C2.6146 26.9265 3.07354 27.3854 3.63803 27.673C4.27976 28 5.11984 28 6.8 28H25.2C26.8802 28 27.7202 28 28.362 27.673C28.9265 27.3854 29.3854 26.9265 29.673 26.362C30 25.7202 30 24.8802 30 23.2V8.8C30 7.11984 30 6.27976 29.673 5.63803C29.3854 5.07354 28.9265 4.6146 28.362 4.32698C27.7202 4 26.8802 4 25.2 4H6.8C5.11984 4 4.27976 4 3.63803 4.32698C3.07354 4.6146 2.6146 5.07354 2.32698 5.63803ZM25.2 6H6.8C5.92692 6 5.39239 6.00156 4.99247 6.03423C4.80617 6.04945 4.69345 6.06857 4.625 6.08469C4.59244 6.09236 4.57241 6.09879 4.56158 6.10265C4.55118 6.10636 4.54601 6.10899 4.54601 6.10899C4.35785 6.20487 4.20487 6.35785 4.10899 6.54601C4.10899 6.54601 4.10636 6.55118 4.10265 6.56158C4.09879 6.57241 4.09236 6.59244 4.08469 6.625C4.06857 6.69345 4.04945 6.80617 4.03423 6.99247C4.00156 7.39239 4 7.92692 4 8.8V23.2C4 24.0731 4.00156 24.6076 4.03423 25.0075C4.04945 25.1938 4.06857 25.3065 4.08469 25.375C4.09236 25.4076 4.09879 25.4276 4.10265 25.4384C4.10636 25.4488 4.10899 25.454 4.10899 25.454C4.20487 25.6422 4.35785 25.7951 4.54601 25.891C4.54601 25.891 4.55118 25.8936 4.56158 25.8973C4.57241 25.9012 4.59244 25.9076 4.625 25.9153C4.69345 25.9314 4.80617 25.9505 4.99247 25.9658C5.39239 25.9984 5.92692 26 6.8 26H25.2C26.0731 26 26.6076 25.9984 27.0075 25.9658C27.1938 25.9505 27.3065 25.9314 27.375 25.9153C27.4076 25.9076 27.4276 25.9012 27.4384 25.8973C27.4488 25.8936 27.454 25.891 27.454 25.891C27.6422 25.7951 27.7951 25.6422 27.891 25.454C27.891 25.454 27.8936 25.4488 27.8973 25.4384C27.9012 25.4276 27.9076 25.4076 27.9153 25.375C27.9314 25.3065 27.9505 25.1938 27.9658 25.0075C27.9984 24.6076 28 24.0731 28 23.2V8.8C28 7.92692 27.9984 7.39239 27.9658 6.99247C27.9505 6.80617 27.9314 6.69345 27.9153 6.625C27.9076 6.59244 27.9012 6.57241 27.8973 6.56158C27.8936 6.55118 27.891 6.54601 27.891 6.54601C27.7951 6.35785 27.6422 6.20487 27.454 6.10899C27.454 6.10899 27.4488 6.10636 27.4384 6.10265C27.4276 6.09879 27.4076 6.09236 27.375 6.08469C27.3065 6.06857 27.1938 6.04945 27.0075 6.03423C26.6076 6.00156 26.0731 6 25.2 6Z"
        fill="#fff"
      />
    </Svg>
  );
}

// --- Page Data ---

interface PageData {
  key: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const PAGES: PageData[] = [
  {
    key: 'yield',
    icon: <YieldIcon size={100} />,
    title: 'Maximise Your Yield',
    description: 'Earn yield across top DeFi protocols:\nJupiter Lend, Kamino, Drift, and more.\nYour assets work for you, 24/7.',
  },
  {
    key: 'non-custodial',
    icon: <KeyIcon size={100} />,
    title: 'Your Keys, Your Crypto',
    description: 'Cashflow is fully self-custodial. You own your private keys and control your funds at all times. No middlemen, no compromises.',
  },
  {
    key: 'security',
    icon: <SecurityIcon size={100} />,
    title: 'Multi-Layer Security',
    description: 'Multisig protection with Squads Protocol. Works with Solana Mobile and hardware wallets. No single point of failure.',
  },
  {
    key: 'setup',
    icon: <VaultIcon size={100} />,
    title: 'Create Your Squad Vault',
    description: 'Connect your wallet and set up a secure multisig vault to get started.',
  },
];

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const flatListRef = useRef<FlatList>(null);
  const { connect: connectWallet } = useWallet();
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastDescription, setToastDescription] = useState('');

  const isLastPage = currentPage === PAGES.length - 1;

  const handleNext = useCallback(() => {
    if (currentPage < PAGES.length - 1) {
      const next = currentPage + 1;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrentPage(next);
    }
  }, [currentPage]);

  const handleSetup = useCallback(async () => {
    setLoading(true);
    try {
      setStatusText('Connecting wallet...');
      const account = await connectWallet();
      if (!account) return;

      setStatusText('Checking balance...');
      const balanceSol = await walletService.getBalance(account.publicKey);
      const minSol = MIN_LAMPORTS_FOR_VAULT / 1e9;
      if (balanceSol < minSol) {
        setToastMessage('Insufficient SOL Balance');
        setToastDescription(
          `You need at least ${minSol} SOL to create a vault.\nCurrent balance: ${balanceSol.toFixed(4)} SOL.`,
        );
        setToastVisible(true);
        return;
      }

      setStatusText('Creating vault...');
      await createMultisig(account.publicKey as string);
      onComplete();
    } catch (err: any) {
      const msg = err?.message || '';
      // Don't show error if user dismissed the wallet popup
      if (!msg.includes('CancellationException')) {
        Alert.alert('Error', msg || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
      setStatusText('');
    }
  }, [connectWallet, onComplete]);

  const onScroll = useCallback((e: any) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentPage(page);
  }, []);

  const renderPage = ({ item }: { item: PageData }) => {
    return (
      <View style={[pageStyles.container, { width: SCREEN_WIDTH }]}>
        <View style={pageStyles.iconContainer}>{item.icon}</View>
        <Text style={pageStyles.title}>{item.title}</Text>
        <Text style={pageStyles.description}>{item.description}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0D4A82', '#175DA3', '#347AC0', '#5A9AD5']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      <Toast
        visible={toastVisible}
        message={toastMessage}
        description={toastDescription}
        type="warning"
        onDismiss={() => setToastVisible(false)}
      />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <FlatList
          ref={flatListRef}
          data={PAGES}
          renderItem={renderPage}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          bounces={false}
        />

        {/* Bottom section: dots + button */}
        <View style={styles.bottomSection}>
          {/* Dot indicators */}
          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentPage && styles.dotActive]}
              />
            ))}
          </View>

          {/* Action button — changes based on page & state */}
          {!isLastPage ? (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={handleNext}
              activeOpacity={0.7}
            >
              <Text style={styles.nextButtonText}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.nextButton, loading && styles.buttonDisabled]}
              onPress={handleSetup}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#175DA3" />
                  <Text style={styles.nextButtonText}>{statusText}</Text>
                </View>
              ) : (
                <Text style={styles.nextButtonText}>Get Started</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
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
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 24,
  },
  nextButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#175DA3',
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

const pageStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 24,
  },
});
